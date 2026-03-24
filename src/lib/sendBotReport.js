function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${h}h ${m}m ${s}s`
}

function sendBotReport(bot, options = {}) {
  const { inventoryOnly = false } = options
  const reportTarget = bot.state?.lastCommandSender || bot.username
  const pos = bot.entity?.position
  const now = Date.now()
  const startedAt = bot.state?.startedAt || now
  const uptime = formatDuration(now - startedAt)

  const x = pos ? pos.x.toFixed(2) : 'N/A'
  const y = pos ? pos.y.toFixed(2) : 'N/A'
  const z = pos ? pos.z.toFixed(2) : 'N/A'

  const health = bot.health ?? 'N/A'
  const food = bot.food ?? 'N/A'

  const dimension = bot.game?.dimension ?? 'N/A'
  const ping = bot.player?.ping ?? 'N/A'
  const inventoryItems = bot.inventory.items()

  const state = bot.state || {}
  const activeStates = [
    state.moving ? 'moving' : null,
    state.sprinting ? 'sprinting' : null,
    state.sneaking ? 'sneaking' : null,
    state.looking ? 'looking' : null,
    state.following ? 'following' : null,
    state.guarding ? 'guarding' : null,
    state.spinning ? 'spinning' : null,
    state.attacking ? 'attacking' : null,
    state.digging ? 'digging' : null,
    state.lookLocked ? 'lookLocked' : null
  ].filter(Boolean)
  const stateSummary = activeStates.length > 0 ? activeStates.join(', ') : 'none'

  const tellraw = (components) => {
    bot.chat(`/tellraw ${reportTarget} ${JSON.stringify({ text: '', extra: components })}`)
  }

  const theme = {
    tag: 'dark_aqua',
    label: 'aqua',
    value: 'white',
    number: 'gold',
    accent: 'blue',
    muted: 'gray'
  }

  const sendInventoryLine = () => {
    if (inventoryItems.length === 0) {
      tellraw([
        { text: 'Inventory: ', color: theme.label },
        { text: 'empty', color: theme.muted }
      ])
    } else {
      const inventoryComponents = [{ text: 'Inventory: ', color: theme.label }]
      for (let i = 0; i < inventoryItems.length; i++) {
        const item = inventoryItems[i]
        const isFullStack = item.count === 64
        if (i > 0) inventoryComponents.push({ text: ', ', color: theme.muted })
        inventoryComponents.push({ text: String(item.count), color: theme.number, bold: isFullStack })
        inventoryComponents.push({ text: ' ' })
        inventoryComponents.push({ text: item.name, color: theme.value, bold: isFullStack })
      }
      tellraw(inventoryComponents)
    }
  }

  if (inventoryOnly) {
    sendInventoryLine()
    return
  }

  if (stateSummary !== 'none') {
    tellraw([
      { text: 'State: ', color: theme.label },
      { text: stateSummary, color: theme.value }
    ])
  }

  sendInventoryLine()

  tellraw([
    { text: 'HP: ', color: theme.label },
    { text: String(health), color: theme.number },
    { text: '  Hunger: ', color: theme.label },
    { text: String(food), color: theme.number }
  ])

  tellraw([
    { text: 'Coords: ', color: theme.label },
    { text: x, color: theme.number },
    { text: ', ', color: theme.muted },
    { text: y, color: theme.number },
    { text: ', ', color: theme.muted },
    { text: z, color: theme.number }
  ])

  tellraw([
    { text: 'Uptime: ', color: theme.label },
    { text: uptime, color: theme.accent },
    { text: '  Dim: ', color: theme.label },
    { text: String(dimension), color: theme.value },
    { text: '  Ping: ', color: theme.label },
    { text: String(ping), color: theme.number }
  ])
}

module.exports = {
  sendBotReport
}