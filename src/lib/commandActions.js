const {
  Vec3,
  lookCardinal,
  lookAtWherePlayerLooks,
  getClosestNonBotPlayerEntity
} = require('./commandHelpers')

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

function executeCommand(bot, action, args, context) {
  const { getCurrentBotNames, getManager } = context

  switch (action) {
    case 'move':
    case 'forward':
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      bot.setControlState('forward', true)
      bot.state.moving = true
      break
    case 'stop':
      bot.state.following = false
      bot.state.guarding = false
      bot.state.spinning = false
      stopAttackLoop(bot)
      stopDigLoop(bot)
      bot.clearControlStates()
      bot.setControlState('jump', false)
      bot.state.moving = false
      break
    case 'back':
      bot.setControlState('forward', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      bot.setControlState('back', true)
      bot.state.moving = true
      break
    case 'left':
      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('right', false)
      bot.setControlState('left', true)
      bot.state.moving = true
      break
    case 'right':
      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', true)
      bot.state.moving = true
      break
    case 'strafe':
      if (args[0] === 'left') {
        bot.setControlState('left', true)
      } else if (args[0] === 'right') {
        bot.setControlState('right', true)
      }
      break

    case 'jump':
      bot.jump()
      break
    case 'doublejump':
      bot.jump()
      setTimeout(() => bot.jump(), 100)
      break

    case 'sprint':
      bot.setControlState('sprint', true)
      bot.state.sprinting = true
      break
    case 'walk':
      bot.setControlState('sprint', false)
      bot.state.sprinting = false
      break

    case 'sneak':
    case 'crouch':
      bot.setControlState('sneak', true)
      bot.state.sneaking = true
      break
    case 'unsneak':
    case 'uncrouch':
      bot.setControlState('sneak', false)
      bot.state.sneaking = false
      break

    case 'look':
      if (args[0] && lookCardinal(bot, args[0])) break

      if (args[0] && args[1] && args[2]) {
        const x = parseFloat(args[0])
        const y = parseFloat(args[1])
        const z = parseFloat(args[2])
        bot.lookAt(new Vec3(x, y, z), true)
      } else if (args[0] === 'player') {
        bot.state.looking = true
        bot.chat('Looking at player')
      } else {
        bot.state.looking = !bot.state.looking
        bot.chat(`Auto-look ${bot.state.looking ? 'enabled' : 'disabled'}`)
      }
      break
    case 'lookat':
      if (!args[0]) {
        lookAtWherePlayerLooks(bot, getCurrentBotNames())
        break
      }

      if (lookCardinal(bot, args[0])) break

      if (args[0] && args[1] && args[2]) {
        const x = parseFloat(args[0])
        const y = parseFloat(args[1])
        const z = parseFloat(args[2])
        bot.lookAt(new Vec3(x, y, z), true)
        break
      }

      bot.chat('<mineflayer> Usage: lookat [x y z|north|south|east|west|up|down]')
      break
    case 'north':
    case 'south':
    case 'east':
    case 'west':
    case 'up':
    case 'down':
      lookCardinal(bot, action)
      break
    case 'turn':
      if (args[0]) {
        const yaw = parseFloat(args[0])
        bot.look(yaw, 0)
      }
      break
    case 'locklook':
      bot.state.lookLocked = true
      bot.state.lockYaw = bot.entity.yaw
      bot.state.lockPitch = bot.entity.pitch
      bot.chat('<mineflayer> Look direction locked')
      break
    case 'unlocklook':
      bot.state.lookLocked = false
      bot.chat('<mineflayer> Look direction unlocked')
      break

    case 'attack':
      startAttackLoop(bot, getManager, 5)
      bot.chat('<mineflayer> Continuous attack enabled (5 CPS)')
      break
    case 'attacknearest': {
      const entities = Object.values(bot.entities)
      const nearest = entities.reduce((prev, cur) => {
        if (!prev) return cur
        const prevDist = prev.position.distanceTo(bot.entity.position)
        const curDist = cur.position.distanceTo(bot.entity.position)
        return curDist < prevDist ? cur : prev
      }, null)
      if (nearest && nearest.name !== 'player') {
        bot.attack(nearest)
      }
      break
    }

    case 'use':
      bot.activate()
      break
    case 'place': {
      const referenceBlock = bot.blockAtCursor(5)
      if (!referenceBlock) {
        bot.chat('<mineflayer> Cannot place: no target block in sight')
        break
      }

      bot.placeBlock(referenceBlock, new Vec3(0, 1, 0)).catch(() => {
        bot.chat('<mineflayer> Place failed')
      })
      break
    }
    case 'dig':
      startDigLoop(bot)
      bot.chat('<mineflayer> Continuous dig enabled')
      break
    case 'activateitem':
      bot.activate()
      break

    case 'drop':
      if (bot.inventory.cursor()) {
        bot.tossStack(bot.inventory.cursor())
      }
      break
    case 'dropall':
    case 'dropallitems': {
      const stacks = bot.inventory.items()
      if (stacks.length === 0) {
        bot.chat('<mineflayer> No items to drop')
        break
      }

      void (async () => {
        for (const stack of stacks) {
          try {
            await bot.tossStack(stack)
          } catch {
            // Continue dropping remaining items.
          }
        }
        bot.chat('<mineflayer> Dropped all inventory items')
      })()
      break
    }
    case 'equip':
      if (args[0]) {
        const itemName = args[0]
        const item = bot.inventory.items().find(i => i.name === itemName)
        if (item) {
          bot.equip(item, 'hand')
        }
      }
      break

    case 'follow':
      bot.state.following = true
      bot.chat('Following player')
      break
    case 'stopfollow':
      bot.state.following = false
      bot.setControlState('forward', false)
      bot.setControlState('jump', false)
      bot.chat('Stopped following')
      break
    case 'guard':
      bot.state.guarding = true
      bot.chat('Guard mode activated')
      break
    case 'stopguard':
      bot.state.guarding = false
      bot.chat('Guard mode deactivated')
      break

    case 'spin': {
      bot.state.spinning = true
      let rotation = 0
      const spinInterval = setInterval(() => {
        bot.look(rotation, 0)
        rotation += 15
        if (rotation >= 360) {
          bot.state.spinning = false
          clearInterval(spinInterval)
        }
      }, 50)
      break
    }
    case 'dance': {
      const danceSequence = [
        () => bot.setControlState('left', true),
        () => {
          bot.setControlState('left', false)
          bot.setControlState('right', true)
        },
        () => {
          bot.setControlState('right', false)
          bot.jump()
        }
      ]
      danceSequence.forEach((danceAction, i) => {
        setTimeout(danceAction, i * 200)
      })
      break
    }

    case 'status':
      bot.chat(
        `Status: moving=${bot.state.moving}, sprinting=${bot.state.sprinting}, sneaking=${bot.state.sneaking}, looking=${bot.state.looking}`
      )
      break
    case 'health':
      bot.chat(`Health: ${bot.health}/${bot.maxHealth}`)
      break

    case 'chat': {
      const chatMsg = args.join(' ')
      if (chatMsg) {
        bot.chat(chatMsg)
      }
      break
    }
    case 'say': {
      const sayMsg = args.join(' ')
      if (sayMsg) {
        bot.chat(sayMsg)
      }
      break
    }

    default:
      bot.chat(`Unknown command: ${action}`)
  }
}

function initializePhysicsTick(bot, context) {
  const { getCurrentBotNames } = context

  bot.on('physicsTick', () => {
    const currentBotNames = getCurrentBotNames()
    const isLookLocked = Boolean(bot.state.lookLocked)

    if (isLookLocked) {
      bot.look(bot.state.lockYaw || 0, bot.state.lockPitch || 0, true)
    }

    if (bot.state.looking && !isLookLocked) {
      const players = Object.values(bot.players)
      const player = players.find(p => !currentBotNames.includes(p.username))

      if (player && player.entity) {
        bot.lookAt(player.entity.position.offset(0, player.entity.height, 0))
      }
    }

    if (bot.state.following) {
      const targetPlayerEntity = getClosestNonBotPlayerEntity(bot, currentBotNames)

      if (targetPlayerEntity) {
        const distance = bot.entity.position.distanceTo(targetPlayerEntity.position)

        if (!isLookLocked) {
          bot.lookAt(targetPlayerEntity.position.offset(0, targetPlayerEntity.height || 1.6, 0), true)
        }

        if (distance > 3) {
          bot.setControlState('forward', true)
          bot.setControlState('jump', true)
          bot.setControlState('sprint', distance > 8)
        } else {
          bot.setControlState('forward', false)
          bot.setControlState('jump', false)
          bot.setControlState('sprint', false)
        }
      } else {
        bot.setControlState('forward', false)
        bot.setControlState('jump', false)
        bot.setControlState('sprint', false)
      }
    }

    if (bot.state.guarding) {
      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
    }
  })
}

module.exports = {
  executeCommand,
  initializePhysicsTick
}
