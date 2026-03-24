/**
 * Command orchestration layer.
 * Keeps public API stable while delegating to focused modules.
 */

const { setManager, getManager, setBotCreator, getBotCreator } = require('./commandState')
const { handleGlobalCommand } = require('./globalCommands')
const { executeCommand: executeAction, initializePhysicsTick: initPhysics } = require('./commandActions')

const GLOBAL_COMMANDS = new Set(['spawn', 'despawn', 'list', 'help'])

function getCurrentBotNames(botNames = []) {
  const manager = getManager()
  const rawBotNames = manager ? manager.getBotNames() : botNames
  return (rawBotNames || []).filter(name => typeof name === 'string' && name.length > 0)
}

function executeCommand(bot, action, args, botNames = []) {
  return executeAction(bot, action, args, {
    getCurrentBotNames: () => getCurrentBotNames(botNames),
    getManager
  })
}

function initializePhysicsTick(bot, botNames = []) {
  return initPhysics(bot, {
    getCurrentBotNames: () => getCurrentBotNames(botNames)
  })
}

function handleChatCommand(bot, botNames = []) {
  bot.on('chat', (username, message) => {
    if (username === bot.username) return

    const currentBotNames = getCurrentBotNames(botNames)

    // Ignore chat from managed bots to prevent chat loops.
    if (currentBotNames.includes(username)) return

    const normalizedMessage = String(message || '').trim()
    if (!normalizedMessage) return

    // Support multi-command chat using "&" separator.
    const segments = normalizedMessage
      .split('&')
      .map(segment => segment.trim())
      .filter(Boolean)

    for (const segment of segments) {
      const args = segment.split(/\s+/)
      const firstWord = args[0]
      const firstWordLower = firstWord.toLowerCase()

      if (GLOBAL_COMMANDS.has(firstWordLower)) {
        handleGlobalCommand(firstWordLower, args.slice(1), bot, {
          getManager,
          getBotCreator
        })
        continue
      }

      const targetBot = currentBotNames.find(name => name.toLowerCase() === firstWordLower)
      if (!targetBot) continue

      const action = (args[1] || '').toLowerCase()
      if (!action) continue

      if (targetBot.toLowerCase() !== bot.username.toLowerCase()) continue

      bot.state = bot.state || {}
      bot.state.lastCommandSender = username

      executeCommand(bot, action, args.slice(2), botNames)
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
