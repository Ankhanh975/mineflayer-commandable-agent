/**
 * Mineflayer Chat Command Bots - Main Entry Point
 * Creates controllable bots with chat commands and dynamic spawn/despawn
 */

const { createBots } = require('./bots')
const { createCommandBot } = require('./bots')
const { setManager, setBotCreator } = require('./lib/commands')
const BotManager = require('./lib/manager')

const botManager = new BotManager()
setManager(botManager)

// Wire global spawn command to actual bot creation.
setBotCreator((name) => {
  const bot = createCommandBot(name, botManager.getBotNames())
  botManager.addBot(bot)
})

// Initial bot names
const initialBotNames = ['Alex']

console.log(`\n=== Mineflayer Bot Controller ===`)
console.log(`Starting ${initialBotNames.length} bot...\n`)

const initialBots = createBots(initialBotNames)

// Register bots with manager
initialBots.forEach(bot => {
  botManager.addBot(bot)
})

console.log(`Bots created: ${botManager.getBotNames().join(', ')}\n`)

console.log(`=== Command Examples ===`)
console.log(`Bot Commands:`)
console.log(`  Alex move`)
console.log(`  Alex jump`)
console.log(`  Alex follow`)
console.log(`  Alex dance\n`)

console.log(`Global Commands (create more bots):`)
console.log(`  spawn          - Create new bot with auto-name`)
console.log(`  spawn David    - Create new bot named David`)
console.log(`  list           - Show all online bots`)
console.log(`  despawn <name> - Remove a bot`)
console.log(`  help           - Show all commands\n`)

console.log(`Type commands in Minecraft chat to control the bots.`)
console.log(`Bots are now idle and won't do anything until commanded.\n`)