function stopDigLoop(bot) {
  if (bot.digLoopTimer) {
    clearTimeout(bot.digLoopTimer)
    bot.digLoopTimer = null
  }
  bot.state.digging = false
}

function startDigLoop(bot) {
  stopDigLoop(bot)
  bot.state.digging = true

  const digNext = async () => {
    if (!bot.state.digging) return

    const targetBlock = bot.blockAtCursor(5)
    if (!targetBlock || !bot.canDigBlock(targetBlock) || bot.targetDigBlock) {
      bot.digLoopTimer = setTimeout(digNext, 100)
      return
    }

    try {
      await bot.dig(targetBlock, false)
    } catch {
      // Ignore transient dig failures and retry next tick.
    }

    bot.digLoopTimer = setTimeout(digNext, 60)
  }

  void digNext()
}

module.exports = {
  stopDigLoop,
  startDigLoop
}