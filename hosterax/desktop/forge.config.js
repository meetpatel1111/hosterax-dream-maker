// hosterax/desktop/forge.config.js
module.exports = {
  packagerConfig: {
    name: "HosteraX",
    executableName: "hosterax",
    icon: "./icon",
    asar: {
      unpack: "{engine/**/*,dist/**/*,node_modules/better-sqlite3/**/*}",
    },
    extraResource: [
      "./engine",
      "./dist",
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "hosterax",
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "linux", "win32"],
    },
    {
      name: "@electron-forge/maker-dmg",
      config: {
        name: "HosteraX",
      },
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          maintainer: "HosteraX Team",
          homepage: "https://hosterax.io",
        },
      },
    },
  ],
};
