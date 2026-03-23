const Vec3 = require('vec3')

function tellrawMineflayer(bot, message) {
  // Keep the tag styling centralized so all status lines look identical.
  const payload = {
    text: '',
    extra: [
      { text: '<mineflayer> ', color: 'dark_gray' },
      { text: String(message), color: 'white' }
    ]
  }

  // Route tagged output through tellraw to target the configured player.
  bot.chat(`/tellraw GoldenApple6 ${JSON.stringify(payload)}`)
}

function globalChat(bot, message) {
  tellrawMineflayer(bot, message)
}

function lookDirection(bot, yaw, pitch = 0) {
  bot.look(yaw, pitch, true)
}

function lookCardinal(bot, direction) {
  switch (direction) {
    case 'north':
      lookDirection(bot, Math.PI)
      return true
    case 'south':
      lookDirection(bot, 0)
      return true
    case 'west':
      lookDirection(bot, Math.PI / 2)
      return true
    case 'east':
      lookDirection(bot, -Math.PI / 2)
      return true
    case 'up':
      lookDirection(bot, bot.entity.yaw, -Math.PI / 2)
      return true
    case 'down':
      lookDirection(bot, bot.entity.yaw, Math.PI / 2)
      return true
    default:
      return false
  }
}

function getClosestNonBotPlayerEntity(bot, botNames) {
  let closest = null
  let closestDist = Infinity

  for (const player of Object.values(bot.players)) {
    if (!player || !player.entity || botNames.includes(player.username)) continue
    const dist = bot.entity.position.distanceTo(player.entity.position)
    if (dist < closestDist) {
      closest = player.entity
      closestDist = dist
    }
  }

  return closest
}

function lookAtWherePlayerLooks(bot, botNames) {
  const targetPlayerEntity = getClosestNonBotPlayerEntity(bot, botNames)
  if (!targetPlayerEntity) {
    tellrawMineflayer(bot, 'No player found to copy look direction')
    return
  }

  const yaw = targetPlayerEntity.yaw || 0
  const pitch = targetPlayerEntity.pitch || 0
  bot.look(yaw, pitch, true)
}

module.exports = {
  Vec3,
  tellrawMineflayer,
  globalChat,
  lookDirection,
  lookCardinal,
  getClosestNonBotPlayerEntity,
  lookAtWherePlayerLooks
}
