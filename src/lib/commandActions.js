const {
  Vec3,
  lookCardinal,
  lookAtWherePlayerLooks,
  getClosestNonBotPlayerEntity
} = require('./commandHelpers')
const { stopAttackLoop, startAttackLoop } = require('./attackLoop')
const { stopDigLoop, startDigLoop } = require('./digLoop')
const { executeFarmAction } = require('./farmActions')
const { sendBotReport } = require('./sendBotReport')

function isEdibleItem(bot, item) {
  if (!item) return false
  if (typeof item.foodPoints === 'number' && item.foodPoints > 0) return true

  const foods = bot.registry?.foodsArray
  if (!Array.isArray(foods)) return false

  return foods.some(food => food.id === item.type || food.name === item.name)
}

function findFirstEdibleItem(bot) {
  return bot.inventory.items().find(item => isEdibleItem(bot, item)) || null
}

function findNearestBed(bot, maxDistance = 15, maxYDelta = 3) {
  const positions = bot.findBlocks({
    matching: (block) => {
      return Boolean(block && typeof block.name === 'string' && block.name.endsWith('_bed'))
    },
    maxDistance,
    count: 64
  })

  const botPos = bot.entity?.position
  if (!botPos || !Array.isArray(positions) || positions.length === 0) return null

  let nearestBed = null
  let nearestDistance = Infinity

  for (const pos of positions) {
    if (Math.abs(pos.y - botPos.y) > maxYDelta) continue
    const block = bot.blockAt(pos)
    if (!block) continue

    const distance = block.position.distanceTo(botPos)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestBed = block
    }
  }

  return nearestBed
}

function executeCommand(bot, action, args, context) {
  const { getCurrentBotNames, getManager } = context

  switch (action) {
    case 'move':
    case 'forward':
      bot.chat('Moving forward')
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      bot.setControlState('forward', true)
      bot.state.moving = true
      break
    case 'stop':
      bot.chat('Stopping')
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
      bot.chat('Moving backward')
      bot.setControlState('forward', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      bot.setControlState('back', true)
      bot.state.moving = true
      break
    case 'left':
      bot.chat('Moving left')
      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('right', false)
      bot.setControlState('left', true)
      bot.state.moving = true
      break
    case 'right':
      bot.chat('Moving right')
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
      bot.setControlState('jump', true)
      bot.chat('Jumping')
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
      bot.chat('Started attacking')
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
    case 'mine':
      startDigLoop(bot)
      bot.chat('Started digging')
      break
    case 'farm': {
      void executeFarmAction(bot)
      break
    }
    case 'activateitem':
      bot.activate()
      break
    case 'sleep': {
      if (bot.isSleeping) {
        bot.chat('<mineflayer> Already sleeping')
        break
      }

      const bed = findNearestBed(bot, 15, 3)
      if (!bed) {
        bot.chat('<mineflayer> No bed found within 15 blocks (and 3 blocks vertically)')
        break
      }

      void (async () => {
        try {
          await bot.sleep(bed)
          bot.chat('<mineflayer> Sleeping now')
        } catch {
          bot.chat('<mineflayer> Failed to sleep in nearby bed')
        }
      })()
      break
    }
    case 'eat': {
      if (typeof bot.food === 'number' && bot.food >= 20) {
        bot.chat('<mineflayer> Hunger already full')
        break
      }

      void (async () => {
        const canConsume = typeof bot.consume === 'function'
        const canActivateItem = typeof bot.activateItem === 'function'

        if (!canConsume && !canActivateItem) {
          bot.chat('<mineflayer> Eating is not supported by this bot version')
          return
        }

        let ateCount = 0
        for (let i = 0; i < 32; i++) {
          if (typeof bot.food === 'number' && bot.food >= 20) break

          const edible = findFirstEdibleItem(bot)
          if (!edible) break

          try {
            await bot.equip(edible, 'hand')

            if (canConsume) {
              await bot.consume()
            } else {
              bot.activateItem()
              await new Promise(resolve => setTimeout(resolve, 1300))
              if (typeof bot.deactivateItem === 'function') bot.deactivateItem()
            }

            ateCount++
          } catch {
            break
          }
        }

        if (ateCount === 0) {
          bot.chat('<mineflayer> No edible item found in inventory')
        } else if (typeof bot.food === 'number' && bot.food >= 20) {
          bot.chat(`<mineflayer> Done eating (${ateCount} item${ateCount === 1 ? '' : 's'}) - hunger full`)
        } else {
          bot.chat(`<mineflayer> Done eating (${ateCount} item${ateCount === 1 ? '' : 's'}) - no more food`)
        }
      })()
      break
    }

    case 'drop': {
      const cursorStack = typeof bot.inventory.cursor === 'function' ? bot.inventory.cursor() : null
      const stackToDrop = cursorStack || bot.heldItem || bot.inventory.items()[0]

      if (!stackToDrop) {
        bot.chat('<mineflayer> No item to drop')
        break
      }

      void bot.tossStack(stackToDrop).catch(() => {
        bot.chat('<mineflayer> Drop failed')
      })
      break
    }
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
        const itemNameQuery = args.join(' ').toLowerCase()
        const item = bot.inventory.items().find(i => i.name.toLowerCase().includes(itemNameQuery))
        if (item) {
          bot.equip(item, 'hand')
        }
      }
      break

    case 'follow':
      bot.state.following = true
      bot.chat('Following you')
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
    case 'info':
    case 'report':
      sendBotReport(bot)
      break
    case 'inventory':
    case 'inv':
      sendBotReport(bot, { inventoryOnly: true })
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
    const hungerAlertThreshold = bot.state.hungerAlertThreshold ?? 8

    if (typeof bot.food === 'number') {
      const isLowHunger = bot.food < hungerAlertThreshold
      if (isLowHunger && !bot.state.hungerAlertSent) {
        bot.chat(`<mineflayer> Hunger low: ${bot.food}/20`)
        bot.state.hungerAlertSent = true
      } else if (!isLowHunger && bot.state.hungerAlertSent) {
        bot.state.hungerAlertSent = false
      }
    }

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
