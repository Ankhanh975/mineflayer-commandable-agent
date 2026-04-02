const { Vec3 } = require('vec3')
const { goals: { GoalNear } } = require('mineflayer-pathfinder')

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

  if (!bot.pathfinder) return false

  const moveTarget = targetPos.clone ? targetPos.clone() : targetPos
  const goal = new GoalNear(moveTarget.x, moveTarget.y, moveTarget.z, Math.max(1, reachDistance))

  let timeoutHandle = null
  try {
    const reached = await Promise.race([
      bot.pathfinder.goto(goal).then(() => true).catch(() => false),
      new Promise(resolve => {
        timeoutHandle = setTimeout(() => resolve(false), timeoutMs)
      })
    ])

    if (!reached) bot.pathfinder.setGoal(null)
    return reached
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

async function moveNearBlockForDig(bot, block, breakDistance = 3, timeoutMs = 6000) {
  if (!block?.position) return false
  return moveNearPosition(bot, block.position.offset(0.5, 0.5, 0.5), breakDistance, timeoutMs)
}

function isDroppedItemEntity(entity) {
  if (!entity || !entity.position) return false
  // if (entity.objectType === 'Item') return true
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
    const targetEntityId = targetDrop.id
    const beforeCount = getInventoryItemCount(bot)

    // Re-check the entity position while approaching so we do not chase a stale location.
    for (let attempt = 0; attempt < 1; attempt++) {
      const liveDrop = bot.entities?.[targetEntityId] || targetDrop
      if (!isDroppedItemEntity(liveDrop)) break

      await moveNearPosition(bot, liveDrop.position.offset(0, -0.9, 0), 0.7, 1800)
      await wait(140)

      const distanceToDrop = bot.entity?.position?.distanceTo(liveDrop.position)
      if (typeof distanceToDrop === 'number' && distanceToDrop <= 0.95) {
        await wait(220)
        break
      }
    }

    const afterCount = getInventoryItemCount(bot)
    if (afterCount > beforeCount) pickedItemCount += afterCount - beforeCount
  }

  if (bot.pathfinder) bot.pathfinder.setGoal(null)
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
    if (distanceToCrop > 3) {
      const movedInRange = await moveNearBlockForDig(bot, targetCrop, 3, 6000)
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

  // Wait briefly so harvested drops spawn and become collectible.
  await wait(320)
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
    if (distanceToFarmland > 3) {
      const movedInRange = await moveNearBlockForDig(bot, targetFarmland, 3, 6000)
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

  await wait(100)
  if (harvested === 0 && pickedUp === 0 && planted === 0) {
    bot.chat('I could not find ripe crops or open farmland nearby.')
  } else {
    bot.chat(`Farm run done: harvested ${harvested}, picked up ${pickedUp}, planted ${planted}.`)
  }
}

module.exports = {
  executeFarmAction
}