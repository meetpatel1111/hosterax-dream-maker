param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
)
& node --max-old-space-size=256 "$PSScriptRoot/hosterax/cli/src/cli.mjs" @Args
