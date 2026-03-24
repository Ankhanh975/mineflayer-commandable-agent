function getForwardAttackTarget(bot, getManager) {
  const target = bot.entityAtCursor(5)
  if (!target) return null

  if (target.type === 'object' || target.type === 'orb' || target.type === 'global') return null

  const manager = getManager()
  if (target.type === 'player' && manager && manager.hasBot(target.username)) return null
  if (target === bot.entity) return null
  return target
}

function stopAttackLoop(bot) {
  if (bot.attackInterval) {
    clearInterval(bot.attackInterval)
    bot.attackInterval = null
  }
  if (bot.state) {
    bot.state.attacking = false
  }
}

function startAttackLoop(bot, getManager, cps = 5) {
  stopAttackLoop(bot)
  const intervalMs = Math.max(1, Math.floor(1000 / cps))

  bot.state.attacking = true
  bot.attackInterval = setInterval(() => {
    const target = getForwardAttackTarget(bot, getManager)
    if (!target) {
      if (typeof bot.swingArm === 'function') {
        try {
          bot.swingArm('right')
        } catch {
          // Ignore swing errors while idle attacking.
        }
      }
      return
    }

    try {
      const result = bot.attack(target)
      if (result && typeof result.catch === 'function') {
        result.catch(() => {})
      }
    } catch {
      // Ignore transient attack errors during combat ticks.
    }
  }, intervalMs)
}

module.exports = {
  getForwardAttackTarget,
  stopAttackLoop,
  startAttackLoop
}