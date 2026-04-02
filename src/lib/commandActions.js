const {
  Vec3,
  lookCardinal,
  lookAtWherePlayerLooks,
  getClosestNonBotPlayerEntity
} = require('./commandHelpers')
const { goals: { GoalFollow } } = require('mineflayer-pathfinder')
const { stopAttackLoop, startAttackLoop } = require('./attackLoop')
const { stopDigLoop, startDigLoop } = require('./digLoop')
const { executeFarmAction } = require('./farmActions')
const { sendBotReport } = require('./sendBotReport')

const HOSTILE_MOB_NAMES = new Set([
  'zombie',
  'zombie_villager',
  'husk',
  'drowned',
  'skeleton',
  'stray',
  'wither_skeleton',
  'spider',
  'cave_spider',
  'creeper',
  'enderman',
  'witch',
  'pillager',
  'vindicator',
  'evoker',
  'ravager',
  'phantom',
  'slime',
  'magma_cube',
  'hoglin',
  'zoglin',
  'warden'
])

function isHostileMobEntity(entity) {
  if (!entity || !entity.position) return false
  const mobName = String(entity.name || '').toLowerCase()
  if (!mobName) return false
  return HOSTILE_MOB_NAMES.has(mobName)
}

function getNearestHostileMob(bot, maxDistance = 8, maxYDelta = 3) {
  const botPos = bot.entity?.position
  if (!botPos) return null

  let nearest = null
  let nearestDistance = Infinity

  for (const entity of Object.values(bot.entities || {})) {
    if (!isHostileMobEntity(entity)) continue
    if (Math.abs(entity.position.y - botPos.y) > maxYDelta) continue

    const distance = botPos.distanceTo(entity.position)
    if (distance > maxDistance) continue
    if (distance < nearestDistance) {
      nearest = entity
      nearestDistance = distance
    }
  }

  return nearest ? { entity: nearest, distance: nearestDistance } : null
}

function isMobApproaching(bot, mob, currentDistance) {
  if (!mob) return false
  if (!bot.state.mobDistanceByEntityId) {
    bot.state.mobDistanceByEntityId = new Map()
  }

  const previousDistance = bot.state.mobDistanceByEntityId.get(mob.id)
  bot.state.mobDistanceByEntityId.set(mob.id, currentDistance)

  const velocity = mob.velocity
  const mobPos = mob.position
  const botPos = bot.entity?.position
  let movingTowardBot = false

  if (velocity && mobPos && botPos) {
    const toBot = botPos.minus(mobPos)
    const towardDot = toBot.x * velocity.x + toBot.y * velocity.y + toBot.z * velocity.z
    movingTowardBot = towardDot > 0.01
  }

  const distanceShrinking = typeof previousDistance === 'number' && previousDistance - currentDistance > 0.03
  return movingTowardBot || distanceShrinking
}

function updateMobBackaway(bot) {
  const now = Date.now()
  const threat = getNearestHostileMob(bot, 8, 3)

  let shouldBackaway = false
  let nearestDistance = Infinity

  if (threat) {
    nearestDistance = threat.distance
    const approaching = isMobApproaching(bot, threat.entity, threat.distance)
    shouldBackaway = threat.distance <= 3.2 || (approaching && threat.distance <= 6)
  }

  if (!threat && bot.state.mobDistanceByEntityId?.size) {
    bot.state.mobDistanceByEntityId.clear()
  }

  if (shouldBackaway) {
    const threatName = String(threat?.entity?.name || 'mob')
    const roundedDistance = Number(nearestDistance).toFixed(1)
    const shouldAnnounce = !bot.state.mobEncounterActive || threatName !== bot.state.lastMobThreatName || now - (bot.state.lastMobEncounterChatAt || 0) > 5000
    if (shouldAnnounce) {
      bot.chat(`Uh oh, ${threatName} is close (${roundedDistance} blocks). Backing up!`)
      bot.state.lastMobEncounterChatAt = now
      bot.state.lastMobThreatName = threatName
    }

    // Face the threat first, then step backward.
    if (threat?.entity?.position) {
      void bot.lookAt(threat.entity.position.offset(0, threat.entity.height || 1.2, 0), true).catch(() => {})
    }

    if (bot.pathfinder) bot.pathfinder.setGoal(null)
    bot.setControlState('forward', false)
    bot.setControlState('left', false)
    bot.setControlState('right', false)
    bot.setControlState('back', true)
    bot.setControlState('sprint', nearestDistance > 2)
    bot.state.evadeUntil = now + 250
    bot.state.evadingMobs = true
    bot.state.mobEncounterActive = true
    return true
  }

  const isEvading = Boolean(bot.state.evadingMobs && now < (bot.state.evadeUntil || 0))
  if (isEvading) {
    bot.setControlState('back', true)
    return true
  }

  if (bot.state.evadingMobs) {
    bot.setControlState('back', false)
    bot.setControlState('sprint', false)
    bot.state.evadingMobs = false
  }

  if (bot.state.mobEncounterActive) {
    bot.chat('All clear now, stopping retreat.')
    bot.state.mobEncounterActive = false
    bot.state.lastMobThreatName = null
    bot.state.lastMobEncounterChatAt = now
  }

  return false
}

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
      bot.chat('Heading forward.')
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      bot.setControlState('forward', true)
      bot.state.moving = true
      break
    case 'stop':
      bot.chat('Okay, stopping.')
      bot.state.following = false
      bot.state.followTargetId = null
      bot.state.followReloadRequested = false
      bot.state.followTargetMissingSince = null
      bot.state.looking = false
      bot.state.guarding = false
      bot.state.spinning = false
      stopAttackLoop(bot)
      stopDigLoop(bot)
      if (bot.pathfinder) bot.pathfinder.setGoal(null)
      bot.clearControlStates()
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
      bot.state.moving = false
      break
    case 'back':
      bot.chat('Backing up.')
      bot.setControlState('forward', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      bot.setControlState('back', true)
      bot.state.moving = true
      break
    case 'left':
      bot.chat('Moving left.')
      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('right', false)
      bot.setControlState('left', true)
      bot.state.moving = true
      break
    case 'right':
      bot.chat('Moving right.')
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
      bot.chat('Jumping!')
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
        bot.chat('Got it, I will keep watching the player.')
      } else {
        bot.state.looking = !bot.state.looking
        bot.chat(`Auto-look is now ${bot.state.looking ? 'on' : 'off'}.`)
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

      bot.chat('Usage: lookat [x y z|north|south|east|west|up|down]')
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
      bot.chat('Locked my look direction.')
      break
    case 'unlocklook':
      bot.state.lookLocked = false
      bot.chat('Unlocked my look direction.')
      break

    case 'attack':
      startAttackLoop(bot, getManager, 5)
      bot.chat('On it, attacking now.')
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
        bot.chat("I can't place that right now, no target block in sight.")
        break
      }

      bot.placeBlock(referenceBlock, new Vec3(0, 1, 0)).catch(() => {
        bot.chat("I couldn't place that block.")
      })
      break
    }
    case 'dig':
    case 'mine':
      startDigLoop(bot)
      bot.chat('Starting to dig.')
      break
    case 'farm': {
      // Farming is a focused task; disable follow/look automation first.
      bot.state.following = false
      bot.state.followTargetId = null
      bot.state.followReloadRequested = false
      bot.state.followTargetMissingSince = null
      bot.state.looking = false
      if (bot.pathfinder) bot.pathfinder.setGoal(null)
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
      void executeFarmAction(bot)
      break
    }
    case 'activateitem':
      bot.activate()
      break
    case 'sleep': {
      if (bot.isSleeping) {
        bot.chat('I am already sleeping.')
        break
      }

      const bed = findNearestBed(bot, 15, 3)
      if (!bed) {
        bot.chat("I can't find a bed within 15 blocks nearby.")
        break
      }

      void (async () => {
        try {
          await bot.sleep(bed)
          bot.chat('Going to sleep now.')
        } catch (err) {
          console.error('Failed to sleep in nearby bed:', err)
          if (err && err.message && (err.message.includes("not night") || err.message.includes("not a thunderstorm"))) {
            try {
              await bot.activateBlock(bed)
              bot.chat('Spawn point set.')
            } catch (err2) {
              console.error('Failed to activate bed ffor spawn:', err2)
              bot.chat(`I could not set spawn: ${err2 && err2.message ? err2.message : err2}`)
            }
          } else {
            bot.chat(`I could not sleep in that bed: ${err && err.message ? err.message : err}`)
          }
        }
      })()
      break
    }
    case 'eat': {
      if (typeof bot.food === 'number' && bot.food >= 20) {
        bot.chat('I am full already.')
        break
      }

      void (async () => {
        const canConsume = typeof bot.consume === 'function'
        const canActivateItem = typeof bot.activateItem === 'function'

        if (!canConsume && !canActivateItem) {
          bot.chat('Eating is not supported on this bot version.')
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
          bot.chat('I could not find food in my inventory.')
        } else if (typeof bot.food === 'number' && bot.food >= 20) {
          bot.chat(`Done eating (${ateCount} item${ateCount === 1 ? '' : 's'}). I am full now.`)
        } else {
          bot.chat(`I ate ${ateCount} item${ateCount === 1 ? '' : 's'}, but I am out of food now.`)
        }
      })()
      break
    }

    case 'drop': {
      const cursorStack = typeof bot.inventory.cursor === 'function' ? bot.inventory.cursor() : null
      const stackToDrop = cursorStack || bot.heldItem || bot.inventory.items()[0]

      if (!stackToDrop) {
        bot.chat('I have nothing to drop.')
        break
      }

      void bot.tossStack(stackToDrop).catch(() => {
        bot.chat('I could not drop that item.')
      })
      break
    }
    case 'dropall':
    case 'dropallitems': {
      const stacks = bot.inventory.items()
      if (stacks.length === 0) {
        bot.chat('I have nothing to drop.')
        break
      }

      void (async () => {
        for (const stack of stacks) {
          try {
            await bot.tossStack(stack)
            await new Promise(resolve => setTimeout(resolve, 200)) // 350ms cooldown between drops
          } catch {
            // Continue dropping remaining items.
          }
        }
        bot.chat('Done, I dropped everything I was carrying.')
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
      if (bot.pathfinder && bot.state.following) {
        // Reset active goal so repeated follow commands re-acquire the target cleanly.
        bot.pathfinder.setGoal(null)
      }
      bot.state.following = true
      bot.state.followReloadRequested = true
      bot.state.followTargetId = null
      bot.state.followTargetMissingSince = null
      bot.chat('On your tail.')
      break
    case 'stopfollow':
      bot.state.following = false
      bot.state.followTargetId = null
      bot.state.followReloadRequested = false
      bot.state.followTargetMissingSince = null
      if (bot.pathfinder) bot.pathfinder.setGoal(null)
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
      bot.chat('Okay, I will stop following you.')
      break
    case 'guard':
      bot.state.guarding = true
      bot.chat('Guard mode is on.')
      break
    case 'stopguard':
      bot.state.guarding = false
      bot.chat('Guard mode is off.')
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
      bot.chat(`I am at ${bot.health}/${bot.maxHealth} health.`)
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
      bot.chat(`I do not recognize that command: ${action}`)
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
        bot.chat(`I am getting hungry (${bot.food}/20).`)
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

    if (updateMobBackaway(bot)) {
      return
    }

    if (bot.state.following) {
      const targetPlayerEntity = getClosestNonBotPlayerEntity(bot, currentBotNames)

      if (targetPlayerEntity) {
        const distance = bot.entity.position.distanceTo(targetPlayerEntity.position)
        bot.state.followTargetMissingSince = null

        // Sprint only when the bot is far from the follow target.
        if (bot.pathfinder?.movements) {
          bot.pathfinder.movements.allowSprinting = distance > 10
        }

        // Let pathfinder control facing while moving; only force look when already near.
        if (!isLookLocked && distance <= 4) {
          bot.lookAt(targetPlayerEntity.position.offset(0, targetPlayerEntity.height || 1.6, 0), true)
        }

        if (bot.pathfinder) {
          const targetId = targetPlayerEntity.id
          const shouldReloadGoal = Boolean(bot.state.followReloadRequested)
          if (bot.state.followTargetId !== targetId || shouldReloadGoal) {
            bot.pathfinder.setGoal(new GoalFollow(targetPlayerEntity, 3), true)
            bot.state.followTargetId = targetId
            bot.state.followReloadRequested = false
          }
        }
      } else {
        if (bot.pathfinder?.movements) {
          bot.pathfinder.movements.allowSprinting = false
        }

        if (!bot.state.followTargetMissingSince) {
          bot.state.followTargetMissingSince = Date.now()
        }

        // Avoid abrupt stop/start jitter when the target briefly unloads.
        if (Date.now() - bot.state.followTargetMissingSince > 1000) {
          if (bot.pathfinder) bot.pathfinder.setGoal(null)
          bot.state.followTargetId = null
          bot.setControlState('jump', false)
          bot.setControlState('sprint', false)
        }
      }
    }

    if (bot.state.guarding) {
      if (bot.pathfinder) bot.pathfinder.setGoal(null)
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
