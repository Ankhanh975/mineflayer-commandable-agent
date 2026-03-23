/**
 * Chat command handler for bots
 * Handles bot commands and global admin commands
 */

let globalManager = null
let botCreator = null
const Vec3 = require('vec3')

// List of available bot names for auto-generation
const availableNames = [
  'Alex', 'Steve', 'Emma', 'James', 'Olivia', 'Liam', 'Ava', 'Noah', 'Sophia', 'Mason',
  'Isabella', 'Lucas', 'Mia', 'Benjamin', 'Charlotte', 'Ethan', 'Amelia', 'Logan', 'Harper', 'Elijah',
  'David', 'Sarah', 'Michael', 'Jessica', 'Daniel', 'Ashley', 'Joseph', 'Emily', 'Thomas', 'Jennifer'
]

function getAvailableName() {
  const usedNames = globalManager.getBotNames()
  const unusedNames = availableNames.filter(name => !usedNames.includes(name))

  if (unusedNames.length > 0) {
    const randomIndex = Math.floor(Math.random() * unusedNames.length)
    return unusedNames[randomIndex]
  }

  // If all predefined names are taken, generate a number-based name
  let counter = 1
  while (usedNames.includes(`Bot${counter}`)) {
    counter++
  }
  return `Bot${counter}`
}

function setManager(manager) {
  globalManager = manager
}

function setBotCreator(creator) {
  botCreator = creator
}

function globalChat(bot, message) {
  bot.chat(`<mineflayer> ${message}`)
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

function lookAtWherePlayerLooks(bot, botNames) {
  const targetPlayerEntity = getClosestNonBotPlayerEntity(bot, botNames)
  if (!targetPlayerEntity) {
    bot.chat('<mineflayer> No player found to copy look direction')
    return
  }

  const eyeHeight = targetPlayerEntity.height || 1.62
  const eyePos = targetPlayerEntity.position.offset(0, eyeHeight, 0)
  const yaw = targetPlayerEntity.yaw || 0
  const pitch = targetPlayerEntity.pitch || 0

  const dir = new Vec3(
    -Math.sin(yaw) * Math.cos(pitch),
    -Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  )

  const lookPoint = eyePos.plus(dir.scaled(8))
  bot.lookAt(lookPoint, true)
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

function getForwardAttackTarget(bot) {
  const target = bot.entityAtCursor(5)
  if (!target) return null

  // Skip non-attackable engine/internal entity categories.
  if (target.type === 'object' || target.type === 'orb' || target.type === 'global') return null

  if (target.type === 'player' && globalManager && globalManager.hasBot(target.username)) return null
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

function startAttackLoop(bot, cps = 5) {
  stopAttackLoop(bot)
  const intervalMs = Math.max(1, Math.floor(1000 / cps))

  bot.state.attacking = true
  bot.attackInterval = setInterval(() => {
    const target = getForwardAttackTarget(bot)
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
      await bot.dig(targetBlock)
    } catch {
      // Ignore transient dig failures and retry next tick.
    }

    bot.digLoopTimer = setTimeout(digNext, 60)
  }

  void digNext()
}

function handleChatCommand(bot, botNames) {
  bot.on('chat', (username, message) => {
    if (username === bot.username) return

    const rawBotNames = globalManager ? globalManager.getBotNames() : botNames
    const currentBotNames = (rawBotNames || []).filter(name => typeof name === 'string' && name.length > 0)

    // Ignore chat coming from other managed bots to prevent echo loops.
    if (currentBotNames.includes(username)) return

    const normalizedMessage = message.trim()
    if (!normalizedMessage) return

    const args = normalizedMessage.split(/\s+/)
    const firstWord = args[0]
    const firstWordLower = firstWord.toLowerCase()

    // Handle global commands (anyone can use these)
    if (firstWordLower === 'spawn' || firstWordLower === 'despawn' || firstWordLower === 'list' || firstWordLower === 'help') {
      // Let only one bot respond to global commands to avoid duplicate replies.
    //   if (globalManager && bot.username !== globalManager.getBotNames()[0]) return
      handleGlobalCommand(firstWordLower, args.slice(1), bot)
      return
    }

    // Resolve target bot name case-insensitively.
    const targetBot = currentBotNames.find(name => name.toLowerCase() === firstWordLower)
    if (!targetBot) {
      // Not a command for bots
      return
    }

    const action = (args[1] || '').toLowerCase()
    if (!action) return

    // Check if this command is for this bot
    if (targetBot.toLowerCase() !== bot.username.toLowerCase()) return

    executeCommand(bot, action, args.slice(2))
  })
}

function handleGlobalCommand(command, args, bot) {
  if (!globalManager) return

  switch (command) {
    case 'spawn':
      const name = args[0] || getAvailableName()
      if (globalManager.hasBot(name)) {
        globalChat(bot, `Bot ${name} already exists`)
      } else {
        globalChat(bot, `Spawning ${name}...`)
        if (typeof botCreator === 'function') {
          botCreator(name)
        } else {
          globalChat(bot, 'Spawn is not configured by script host')
        }
      }
      break

    case 'despawn':
      if (args[0]) {
        const targetName = args[0]
        if (globalManager.removeBot(targetName)) {
          globalChat(bot, `Despawned ${targetName}`)
        } else {
          globalChat(bot, `Bot ${targetName} not found`)
        }
      } else {
        globalChat(bot, 'Usage: despawn <name>')
      }
      break

    case 'list':
      const names = globalManager.getBotNames()
      if (names.length === 0) {
        globalChat(bot, 'No bots online')
      } else {
        globalChat(bot, `Bots online (${names.length}): ${names.join(', ')}`)
      }
      break

    case 'help':
      globalChat(bot, '=== Bot Commands ===')
      globalChat(bot, '<name> move/stop/jump/sprint/walk/sneak/unsneak')
      globalChat(bot, '<name> attack/use/dig/place/drop/dropall')
      globalChat(bot, '<name> look/lookat/turn/north/south/east/west/up/down')
      globalChat(bot, '<name> follow/guard/spin/dance')
      globalChat(bot, '<name> status/health/say <msg>')
      globalChat(bot, '=== Global Commands ===')
      globalChat(bot, 'list - Show all bots')
      globalChat(bot, 'spawn [name] - Spawn new bot (auto-name if omitted)')
      globalChat(bot, 'despawn <name> - Despawn bot')
      globalChat(bot, 'help - Show this message')
      break
  }
}


function executeCommand(bot, action, args) {
  switch (action) {
    // Movement
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

    // Jumping and vertical
    case 'jump':
      bot.jump()
      break
    case 'doublejump':
      bot.jump()
      setTimeout(() => bot.jump(), 100)
      break

    // Sprint/Walk
    case 'sprint':
      bot.setControlState('sprint', true)
      bot.state.sprinting = true
      break
    case 'walk':
      bot.setControlState('sprint', false)
      bot.state.sprinting = false
      break

    // Sneaking
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

    // Looking
    case 'look':
      if (args[0] && lookCardinal(bot, args[0])) {
        break
      }

      if (args[0] && args[1] && args[2]) {
        const x = parseFloat(args[0])
        const y = parseFloat(args[1])
        const z = parseFloat(args[2])
        bot.lookAt(new Vec3(x, y, z), true)
      } else if (args[0] === 'player') {
        // Look at player
        bot.state.looking = true
        bot.chat('Looking at player')
      } else {
        // Toggle auto-look
        bot.state.looking = !bot.state.looking
        bot.chat(`Auto-look ${bot.state.looking ? 'enabled' : 'disabled'}`)
      }
      break
    case 'lookat':
      if (!args[0]) {
        lookAtWherePlayerLooks(bot, globalManager ? globalManager.getBotNames() : botNames)
        break
      }

      if (lookCardinal(bot, args[0])) {
        break
      }

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

    // Combat
    case 'attack':
      startAttackLoop(bot, 5)
      bot.chat('<mineflayer> Continuous attack enabled (5 CPS)')
      break
    case 'attacknearest':
      const entities = Object.values(bot.entities)
      const nearest = entities.reduce((prev, cur) => {
        if (!prev) return cur
        const prevDist = prev.position.distanceTo(bot.entity.position)
        const curDist = cur.position.distanceTo(bot.entity.position)
        return curDist < prevDist ? cur : prev
      })
      if (nearest && nearest.name !== 'player') {
        bot.attack(nearest)
      }
      break

    // Interaction
    case 'use':
      bot.activate()
      break
    case 'place':
      {
        const referenceBlock = bot.blockAtCursor(5)
        if (!referenceBlock) {
          bot.chat('<mineflayer> Cannot place: no target block in sight')
          break
        }

        const Vec3 = require('vec3')
        bot.placeBlock(referenceBlock, new Vec3(0, 1, 0)).catch(() => {
          bot.chat('<mineflayer> Place failed')
        })
      }
      break
    case 'dig':
      startDigLoop(bot)
      bot.chat('<mineflayer> Continuous dig enabled')
      break
    case 'activateitem':
      bot.activate()
      break

    // Inventory
    case 'drop':
      if (bot.inventory.cursor()) {
        bot.tossStack(bot.inventory.cursor())
      }
      break
    case 'dropall':
      for (let i = 0; i < bot.inventory.slots.length; i++) {
        if (bot.inventory.slots[i]) {
          bot.tossStack(bot.inventory.slots[i])
        }
      }
      break
    case 'equip':
      if (args[0]) {
        const itemName = args[0]
        const item = bot.inventory.items().find(i => i.name === itemName)
        if (item) {
          bot.equip(item, 'hand')
        }
      }
      break

    // Behaviors
    case 'follow':
      bot.state.following = true
      bot.chat('Following player')
      break
    case 'stopfollow':
      bot.state.following = false
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

    // Spinning/Dancing
    case 'spin':
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
    case 'dance':
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
      danceSequence.forEach((action, i) => {
        setTimeout(action, i * 200)
      })
      break

    // Status commands
    case 'status':
      bot.chat(
        `Status: moving=${bot.state.moving}, sprinting=${bot.state.sprinting}, sneaking=${bot.state.sneaking}, looking=${bot.state.looking}`
      )
      break
    case 'health':
      bot.chat(`Health: ${bot.health}/${bot.maxHealth}`)
      break

    // Server interaction
    case 'chat':
      const chatMsg = args.join(' ')
      if (chatMsg) {
        bot.chat(chatMsg)
      }
      break
    case 'say':
      const sayMsg = args.join(' ')
      if (sayMsg) {
        bot.chat(sayMsg)
      }
      break

    default:
      bot.chat(`Unknown command: ${action}`)
  }
}

function initializePhysicsTick(bot, botNames) {
  bot.on('physicsTick', () => {
    const currentBotNames = globalManager ? globalManager.getBotNames() : botNames

    // Auto-look at player
    if (bot.state.looking) {
      const players = Object.values(bot.players)
      const player = players.find(p => !currentBotNames.includes(p.username))

      if (player && player.entity) {
        bot.lookAt(player.entity.position.offset(0, player.entity.height, 0))
      }
    }

    // Follow player
    if (bot.state.following) {
      const targetPlayerEntity = getClosestNonBotPlayerEntity(bot, currentBotNames)

      if (targetPlayerEntity) {
        const distance = bot.entity.position.distanceTo(targetPlayerEntity.position)

        // Face target while following for stable movement.
        bot.lookAt(targetPlayerEntity.position.offset(0, targetPlayerEntity.height || 1.6, 0), true)

        if (distance > 3) {
          bot.setControlState('forward', true)
        } else {
          bot.setControlState('forward', false)
        }
      } else {
        bot.setControlState('forward', false)
      }
    }

    // Guard - stay in place and look around
    if (bot.state.guarding) {
      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
    }
  })
}

module.exports = {
  handleChatCommand,
  executeCommand,
  initializePhysicsTick,
  setManager,
  setBotCreator
}