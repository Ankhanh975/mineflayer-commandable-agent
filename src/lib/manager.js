/**
 * Bot Manager - handles spawning and despawning bots
 */

class BotManager {
  constructor() {
    this.bots = []
    this.botNames = new Set()
  }

  addBot(bot) {
    this.bots.push(bot)

    const registerName = () => {
      if (typeof bot.username === 'string' && bot.username.length > 0) {
        this.botNames.add(bot.username)
      }
    }

    // Username may not be immediately available during early lifecycle.
    registerName()
    bot.once('spawn', registerName)
  }

  removeBot(name) {
    const index = this.bots.findIndex(b => b.username === name)
    if (index > -1) {
      const bot = this.bots[index]
      this.bots.splice(index, 1)
      this.botNames.delete(name)
      
      // Disconnect the bot
      if (bot.quit) {
        bot.quit()
      }
      return true
    }
    return false
  }

  getBotNames() {
    return Array.from(this.botNames).filter(name => typeof name === 'string' && name.length > 0)
  }

  hasBot(name) {
    return this.botNames.has(name)
  }

  getAllBots() {
    return this.bots
  }

  getBot(name) {
    return this.bots.find(b => b.username === name)
  }
}

module.exports = BotManager