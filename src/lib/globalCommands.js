const { globalChat } = require('./commandHelpers')

const availableNames = [
  'Alex', 'Steve', 'Emma', 'James', 'Olivia', 'Liam', 'Ava', 'Noah', 'Sophia', 'Mason',
  'Isabella', 'Lucas', 'Mia', 'Benjamin', 'Charlotte', 'Ethan', 'Amelia', 'Logan', 'Harper', 'Elijah',
  'David', 'Sarah', 'Michael', 'Jessica', 'Daniel', 'Ashley', 'Joseph', 'Emily', 'Thomas', 'Jennifer'
]

function getAvailableName(manager) {
  const usedNames = manager.getBotNames()
  const unusedNames = availableNames.filter(name => !usedNames.includes(name))

  if (unusedNames.length > 0) {
    const randomIndex = Math.floor(Math.random() * unusedNames.length)
    return unusedNames[randomIndex]
  }

  let counter = 1
  while (usedNames.includes(`Bot${counter}`)) {
    counter++
  }
  return `Bot${counter}`
}

function handleGlobalCommand(command, args, bot, context) {
  const { getManager, getBotCreator } = context
  const manager = getManager()
  if (!manager) return

  switch (command) {
    case 'spawn': {
      const name = args[0] || getAvailableName(manager)
      if (manager.hasBot(name)) {
        globalChat(bot, `Bot ${name} already exists`)
      } else {
        globalChat(bot, `Spawning ${name}...`)
        const botCreator = getBotCreator()
        if (typeof botCreator === 'function') {
          botCreator(name)
        } else {
          globalChat(bot, 'Spawn is not configured by script host')
        }
      }
      break
    }

    case 'despawn': {
      if (args[0]) {
        const targetName = args[0]
        if (manager.removeBot(targetName)) {
          globalChat(bot, `Despawned ${targetName}`)
        } else {
          globalChat(bot, `Bot ${targetName} not found`)
        }
      } else {
        globalChat(bot, 'Usage: despawn <name>')
      }
      break
    }

    case 'list': {
      const names = manager.getBotNames()
      if (names.length === 0) {
        globalChat(bot, 'No bots online')
      } else {
        globalChat(bot, `Bots online (${names.length}): ${names.join(', ')}`)
      }
      break
    }

    case 'help': {
      globalChat(bot, '=== Bot Commands ===')
      globalChat(bot, '<name> move/stop/jump/sprint/walk/sneak/unsneak')
      globalChat(bot, '<name> attack/use/dig/place/drop/dropall')
      globalChat(bot, '<name> look/lookat/turn/north/south/east/west/up/down')
      globalChat(bot, '<name> locklook/unlocklook')
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
}

module.exports = {
  handleGlobalCommand
}
