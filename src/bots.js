const mineflayer = require('mineflayer')
const { handleChatCommand, initializePhysicsTick } = require('./lib/commands')

function botStatusChat(bot, message) {
  try {
    bot.chat(`<mineflayer> ${message}`)
  } catch {
    // Ignore when chat cannot be sent (for example during disconnect).
  }
}

/**
 * Create a bot with chat command functionality
 * @param {string} name - Bot username
 * @param {string[]} botNames - List of all bot names for identification
 * @return {Bot} Mineflayer bot instance with command handlers
 */
function createCommandBot(name, botNames = []) {
  const bot = mineflayer.createBot({
    username: name,
    auth: 'offline',
    respawn: false
  })

  let respawnTimer = null

  // Initialize bot state
  bot.state = {
    moving: false,
    sprinting: false,
    sneaking: false,
    looking: false,
    following: false,
    guarding: false,
    spinning: false
  }

  // Event handlers
  bot.on('spawn', () => {
    if (respawnTimer) {
      clearTimeout(respawnTimer)
      respawnTimer = null
    }
    botStatusChat(bot, `${bot.username} spawned`)
  })

  bot.on('death', () => {
    if (respawnTimer) clearTimeout(respawnTimer)

    botStatusChat(bot, `${bot.username} died, respawning in 10 seconds...`)
    respawnTimer = setTimeout(() => {
      try {
        bot.respawn()
      } catch (error) {
        botStatusChat(bot, `${bot.username} respawn failed: ${error}`)
      }
    }, 10000)
  })

  // Setup physics tick for continuous behaviors
  initializePhysicsTick(bot, botNames)

  // Setup chat command handler
  handleChatCommand(bot, botNames)

  // Error handling
  bot.on('kicked', (reason) => {
    botStatusChat(bot, `${bot.username} kicked: ${reason}`)
  })

  bot.on('error', (error) => {
    botStatusChat(bot, `${bot.username} error: ${error}`)
  })

  return bot
}

/**
 * Create multiple controllable bots
 * @param {string[]} names - Array of bot usernames
 * @return {Bot[]} Array of bot instances
 */
function createBots(names) {
  const bots = []

  names.forEach((name) => {
    const bot = createCommandBot(name, names)
    bots.push(bot)
  })

  return bots
}

module.exports = {
  createCommandBot,
  createBots
}