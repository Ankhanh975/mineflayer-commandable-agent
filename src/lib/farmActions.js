const { Vec3 } = require('vec3')

const HARVESTABLE_CROP_MAX_AGE = {
  wheat: 7,
  carrots: 7,
  potatoes: 7,
  beetroots: 3,
  nether_wart: 3
}

const FARMLAND_PLANTABLE_ITEMS = ['wheat_seeds', 'beetroot_seeds', 'carrot', 'potato']

function getCropAge(block) {
  if (!block) return null

  const ageFromProperties = block.getProperties && block.getProperties().age
  if (typeof ageFromProperties === 'number') return ageFromProperties

  if (typeof block.metadata === 'number') return block.metadata
  return null
}

function isHarvestableCrop(block) {
  if (!block || typeof block.name !== 'string') return false

  const maxAge = HARVESTABLE_CROP_MAX_AGE[block.name]
  if (typeof maxAge !== 'number') return false

  const age = getCropAge(block)
  return typeof age === 'number' && age >= maxAge
}

function findNearestHarvestableCrop(bot, maxDistance = 16, maxYDelta = 3) {
  const positions = bot.findBlocks({
    matching: (block) => isHarvestableCrop(block),
    maxDistance,
    count: 128
  })

  const botPos = bot.entity?.position
  if (!botPos || !Array.isArray(positions) || positions.length === 0) return null

  let nearestCrop = null
  let nearestDistance = Infinity

  for (const pos of positions) {
    if (Math.abs(pos.y - botPos.y) > maxYDelta) continue
    const block = bot.blockAt(pos)
    if (!isHarvestableCrop(block)) continue

    const distance = block.position.distanceTo(botPos)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestCrop = block
    }
  }

  return nearestCrop
}

function isAirBlock(block) {
  return Boolean(block && typeof block.name === 'string' && (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air'))
}

function findFirstPlantableFarmlandItem(bot) {
  const items = bot.inventory.items()
  for (const itemName of FARMLAND_PLANTABLE_ITEMS) {
    const match = items.find(item => item && item.name === itemName)
    if (match) return match
  }
  return null
}

function findNearestPlantableFarmland(bot, maxDistance = 16, maxYDelta = 3) {
  const positions = bot.findBlocks({
    matching: (block) => block && block.name === 'farmland',
    maxDistance,
    count: 256
  })

  const botPos = bot.entity?.position
  if (!botPos || !Array.isArray(positions) || positions.length === 0) return null

  let nearestFarmland = null
  let nearestDistance = Infinity

  for (const pos of positions) {
    if (Math.abs(pos.y - botPos.y) > maxYDelta) continue

    const farmland = bot.blockAt(pos)
    if (!farmland || farmland.name !== 'farmland') continue

    const above = bot.blockAt(pos.offset(0, 1, 0))
    if (!isAirBlock(above)) continue

    const distance = farmland.position.distanceTo(botPos)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestFarmland = farmland
    }
  }

  return nearestFarmland
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getInventoryItemCount(bot) {
  return bot.inventory.items().reduce((total, item) => total + (item?.count || 0), 0)
}

async function moveNearPosition(bot, targetPos, reachDistance = 2, timeoutMs = 6000) {
  if (!bot?.entity?.position || !targetPos) return false

  const startedAt = Date.now()
  const moveTarget = targetPos.clone ? targetPos.clone() : targetPos

  while (Date.now() - startedAt < timeoutMs) {
    const currentDistance = bot.entity.position.distanceTo(moveTarget)
    if (currentDistance <= reachDistance) {
      bot.setControlState('forward', false)
      bot.setControlState('sprint', false)
      bot.setControlState('jump', false)
      return true
    }

    try {
      await bot.lookAt(moveTarget, true)
    } catch {
      // Ignore transient look failures while moving.
    }

    bot.setControlState('forward', true)
    bot.setControlState('sprint', currentDistance > 8)
    bot.setControlState('jump', moveTarget.y > bot.entity.position.y + 0.8)

    await wait(100)
  }

  bot.setControlState('forward', false)
  bot.setControlState('sprint', false)
  bot.setControlState('jump', false)
  return false
}

async function moveNearBlockForDig(bot, block, breakDistance = 4.5, timeoutMs = 6000) {
  if (!block?.position) return false
  return moveNearPosition(bot, block.position.offset(0.5, 0.5, 0.5), breakDistance, timeoutMs)
}

function isDroppedItemEntity(entity) {
  if (!entity || entity.type !== 'object' || !entity.position) return false
  if (entity.objectType === 'Item') return true
  if (entity.name === 'item') return true
  if (entity.displayName === 'Item') return true
  return false
}

function findNearestDroppedItem(bot, maxDistance = 16, maxYDelta = 4) {
  const botPos = bot.entity?.position
  if (!botPos) return null

  let nearest = null
  let nearestDistance = Infinity

  for (const entity of Object.values(bot.entities || {})) {
    if (!isDroppedItemEntity(entity)) continue
    if (Math.abs(entity.position.y - botPos.y) > maxYDelta) continue

    const distance = botPos.distanceTo(entity.position)
    if (distance > maxDistance) continue
    if (distance < nearestDistance) {
      nearest = entity
      nearestDistance = distance
    }
  }

  return nearest
}

async function collectDroppedItems(bot, maxPasses = 32) {
  let pickedItemCount = 0
  let idlePasses = 0

  for (let i = 0; i < maxPasses; i++) {
    const targetDrop = findNearestDroppedItem(bot, 16, 4)
    if (!targetDrop) {
      idlePasses++
      if (idlePasses >= 2) break
      await wait(180)
      continue
    }

    idlePasses = 0
    const beforeCount = getInventoryItemCount(bot)
    await moveNearPosition(bot, targetDrop.position.offset(0, 0.1, 0), 1.25, 4500)
    await wait(220)
    const afterCount = getInventoryItemCount(bot)
    if (afterCount > beforeCount) pickedItemCount += afterCount - beforeCount
  }

  bot.setControlState('forward', false)
  bot.setControlState('sprint', false)
  bot.setControlState('jump', false)
  return pickedItemCount
}

async function executeFarmAction(bot) {
  let harvested = 0
  let pickedUp = 0
  let planted = 0

  for (let i = 0; i < 32; i++) {
    const crop = findNearestHarvestableCrop(bot, 16, 3)
    if (!crop) break

    const cropPos = crop.position.clone ? crop.position.clone() : crop.position
    let targetCrop = bot.blockAt(cropPos)
    if (!targetCrop || !isHarvestableCrop(targetCrop)) continue

    const distanceToCrop = bot.entity.position.distanceTo(cropPos.offset(0.5, 0.5, 0.5))
    if (distanceToCrop > 4.5) {
      const movedInRange = await moveNearBlockForDig(bot, targetCrop, 4.5, 6000)
      if (!movedInRange) continue
      targetCrop = bot.blockAt(cropPos)
      if (!targetCrop || !isHarvestableCrop(targetCrop)) continue
    }

    if (!bot.canDigBlock(targetCrop) || bot.targetDigBlock) break

    try {
      await bot.dig(targetCrop, false)
      harvested++
    } catch {
      break
    }

    await wait(60)
  }

  pickedUp = await collectDroppedItems(bot)

  for (let i = 0; i < 64; i++) {
    const plantableItem = findFirstPlantableFarmlandItem(bot)
    if (!plantableItem) break

    const farmland = findNearestPlantableFarmland(bot, 16, 3)
    if (!farmland) break

    const farmlandPos = farmland.position.clone ? farmland.position.clone() : farmland.position
    let targetFarmland = bot.blockAt(farmlandPos)
    if (!targetFarmland || targetFarmland.name !== 'farmland') continue

    const above = bot.blockAt(farmlandPos.offset(0, 1, 0))
    if (!isAirBlock(above)) continue

    const distanceToFarmland = bot.entity.position.distanceTo(farmlandPos.offset(0.5, 0.5, 0.5))
    if (distanceToFarmland > 4.5) {
      const movedInRange = await moveNearBlockForDig(bot, targetFarmland, 4.5, 6000)
      if (!movedInRange) continue

      targetFarmland = bot.blockAt(farmlandPos)
      if (!targetFarmland || targetFarmland.name !== 'farmland') continue
      const aboveAfterMove = bot.blockAt(farmlandPos.offset(0, 1, 0))
      if (!isAirBlock(aboveAfterMove)) continue
    }

    try {
      await bot.equip(plantableItem, 'hand')
      await bot.placeBlock(targetFarmland, new Vec3(0, 1, 0))
      planted++
    } catch {
      // Skip this spot/item and continue planting elsewhere.
    }

    await wait(60)
  }

  if (harvested === 0 && pickedUp === 0 && planted === 0) {
    bot.chat('<mineflayer> No harvestable crops or plantable farmland nearby')
  } else {
    bot.chat(`<mineflayer> Farm done: harvested ${harvested}, picked ${pickedUp}, planted ${planted}`)
  }
}

module.exports = {
  executeFarmAction
}