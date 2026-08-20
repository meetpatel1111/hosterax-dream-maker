// hosterax/engine/src/gpu-manager.mjs
// Real-time NVIDIA GPU & VRAM Telemetry + AI Pre-Flight Validator for HosteraX

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export class GpuManager {
  constructor(db) {
    this.db = db;
    this.cachedGpu = null;
    this.lastChecked = 0;
    this.cacheTtlMs = 3000; // 3 seconds cache
  }

  /**
   * Probes system GPU availability and hardware metrics
   */
  async getGpuMetrics() {
    const now = Date.now();
    if (this.cachedGpu && now - this.lastChecked < this.cacheTtlMs) {
      return this.cachedGpu;
    }

    try {
      // 1. Try querying nvidia-smi with CSV output format
      const { stdout } = await execAsync(
        "nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,memory.free,temperature.gpu,utilization.gpu,power.draw --format=csv,noheader,nounits",
        { timeout: 2500 }
      );

      const lines = stdout.trim().split("\n").filter(Boolean);
      if (lines.length > 0) {
        const gpus = lines.map((line, idx) => {
          const parts = line.split(",").map((p) => p.trim());
          const name = parts[0] || `NVIDIA GPU ${idx}`;
          const driverVersion = parts[1] || "N/A";
          const memoryTotalMb = Number.parseFloat(parts[2]) || 0;
          const memoryUsedMb = Number.parseFloat(parts[3]) || 0;
          const memoryFreeMb = Number.parseFloat(parts[4]) || 0;
          const temperatureC = Number.parseFloat(parts[5]) || 0;
          const utilizationGpuPercent = Number.parseFloat(parts[6]) || 0;
          const powerDrawWatts = Number.parseFloat(parts[7]) || 0;

          const memoryUsagePercent = memoryTotalMb > 0
            ? Math.round((memoryUsedMb / memoryTotalMb) * 100)
            : 0;

          return {
            index: idx,
            name,
            driverVersion,
            memoryTotalMb,
            memoryUsedMb,
            memoryFreeMb,
            memoryUsagePercent,
            temperatureC,
            utilizationGpuPercent,
            powerDrawWatts,
            status: "online",
            cudaSupported: true,
          };
        });

        const primary = gpus[0];
        const res = {
          hasGpu: true,
          provider: "nvidia",
          count: gpus.length,
          primary,
          gpus,
          timestamp: now,
        };

        this.cachedGpu = res;
        this.lastChecked = now;
        return res;
      }
    } catch {
      // nvidia-smi not available or non-NVIDIA system
    }

    // Graceful fallback for non-NVIDIA / CPU-only machines
    const fallback = {
      hasGpu: false,
      provider: "none",
      count: 0,
      primary: null,
      gpus: [],
      timestamp: now,
      message: "No dedicated NVIDIA GPU detected. CPU emulation active.",
    };

    this.cachedGpu = fallback;
    this.lastChecked = now;
    return fallback;
  }

  /**
   * Pre-flight VRAM estimation for AI models (Ollama, vLLM, DeepSeek, LocalAI)
   * @param {string} modelName e.g. "llama3:8b", "deepseek-r1:7b", "mistral:7b"
   * @param {number} customRequirementMb optional custom size in MB
   */
  async checkVramRequirement(modelName = "", customRequirementMb = null) {
    const gpuMetrics = await this.getGpuMetrics();

    // Default heuristics for popular quantized LLM model sizes (in MB)
    const MODEL_VRAM_MAP = {
      "llama3:8b": 5600,
      "llama3.1:8b": 5800,
      "llama3.2:1b": 1300,
      "llama3.2:3b": 2400,
      "deepseek-r1:1.5b": 1500,
      "deepseek-r1:7b": 5200,
      "deepseek-r1:8b": 5800,
      "deepseek-r1:14b": 10500,
      "deepseek-r1:32b": 22000,
      "mistral:7b": 5100,
      "mixtral:8x7b": 32000,
      "qwen2.5:7b": 5200,
      "qwen2.5-coder:7b": 5300,
      "phi3:mini": 2800,
      "gemma2:9b": 6400,
      "whisper:large-v3": 3800,
      "sdxl:turbo": 6800,
      "comfyui": 7200,
    };

    const cleanModel = modelName.toLowerCase().trim();
    let requiredMb = customRequirementMb || MODEL_VRAM_MAP[cleanModel] || 4500;

    // Check if partial match
    if (!customRequirementMb && !MODEL_VRAM_MAP[cleanModel]) {
      for (const [key, vram] of Object.entries(MODEL_VRAM_MAP)) {
        if (cleanModel.includes(key.split(":")[0])) {
          requiredMb = vram;
          break;
        }
      }
    }

    if (!gpuMetrics.hasGpu || !gpuMetrics.primary) {
      return {
        compatible: true,
        canFitGpu: false,
        requiredMb,
        availableVramMb: 0,
        mode: "cpu_fallback",
        recommendation: "Will run in CPU mode. Inference will be slower.",
      };
    }

    const freeVram = gpuMetrics.primary.memoryFreeMb;
    const canFitGpu = freeVram >= requiredMb;

    return {
      compatible: true,
      canFitGpu,
      requiredMb,
      availableVramMb: freeVram,
      totalVramMb: gpuMetrics.primary.memoryTotalMb,
      gpuName: gpuMetrics.primary.name,
      mode: canFitGpu ? "gpu_accelerated" : "cpu_hybrid",
      recommendation: canFitGpu
        ? `Fully fits into ${gpuMetrics.primary.name} (${Math.round(requiredMb / 1024 * 10) / 10} GB VRAM required, ${Math.round(freeVram / 1024 * 10) / 10} GB free).`
        : `Requires ~${Math.round(requiredMb / 1024 * 10) / 10} GB VRAM, but only ${Math.round(freeVram / 1024 * 10) / 10} GB is free. Will offload overflow to system RAM.`,
    };
  }
}
