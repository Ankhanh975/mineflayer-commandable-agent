let globalManager = null
let botCreator = null

function setManager(manager) {
  globalManager = manager
}

function getManager() {
  return globalManager
}

function setBotCreator(creator) {
  botCreator = creator
}

function getBotCreator() {
  return botCreator
}

module.exports = {
  setManager,
  getManager,
  setBotCreator,
  getBotCreator
}
