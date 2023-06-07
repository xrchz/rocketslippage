#!/usr/bin/env node

import { program } from 'commander'
import { ethers } from 'ethers'
import * as https from 'node:https'
import Fraction from 'fraction.js'
import * as fs from 'node:fs/promises'

const ETHAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const rETHAddress = new Map()
rETHAddress.set('mainnet', '0xae78736Cd615f374D3085123A210448E74Fc6393')
rETHAddress.set('arbitrum', '0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8')
rETHAddress.set('optimism', '0x9bcef72be871e61ed4fbbc7630889bee758eb81d')
rETHAddress.set('polygon', '0x0266F4F08D82372CF0FcbCCc0Ff74309089c74d1')

const chainIds = new Map()
chainIds.set('mainnet', 1)
chainIds.set('arbitrum', 42161)
chainIds.set('optimism', 10)
chainIds.set('polygon', 137)

program
  .option('--no-mainnet', 'skip mainnet')
  .option('--no-optimism', 'skip optimism')
  .option('--no-arbitrum', 'skip arbitrum')
  .option('--polygon', 'do not skip polygon')
  .option('--oneInchAPI <url>', '1Inch API base URL', 'https://api.1inch.io/v5.0')
  .option('--tolerance <zeros>', 'How precise to be about 1%: number of zeros needed in 0.99[00000...]', 2)
  .option('--filename <template>', 'Template for files to append csv datapoints to', '../<direction>-1%-1Inch-<network>.csv')
  .option('--expiry <queries>', 'Maximum number of binary search steps before refreshing spot', 10)
  .option('--spot-mainnet', 'ETH amount for spot price on mainnet', '10')
  .option('--spot-layer2', 'ETH amount for spot price on not mainnet', '1')

program.parse()
const options = program.opts()

const maxCallsPerPeriod = 5
const timePeriod = 60000
const betweenDelay = 8000
const apiCallTimes = []
function updateApiCallTimes() {
  while (apiCallTimes.length && apiCallTimes[0] < (Date.now() - timePeriod))
    apiCallTimes.shift()
}

async function rateLimit() {
  while (apiCallTimes.length >= maxCallsPerPeriod) {
    await new Promise(resolve => {
      setTimeout(() => resolve(updateApiCallTimes()),
        Math.max(10, apiCallTimes[0] - (Date.now() - timePeriod)))
    })
  }
  await new Promise(resolve => setTimeout(resolve, betweenDelay))
}

function oneInchAPI(chainId, method, query) {
  const queryString = new URLSearchParams(query).toString()
  const url = `${options.oneInchAPI}/${chainId}/${method}?${queryString}`
  const call = new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode !== 200) {
        console.error(`${url} returned ${res.statusCode}: ${res.statusMessage}`)
        reject(res)
      }
      res.setEncoding('utf8')
      let data = []
      res.on('data', chunk => data.push(chunk))
      res.on('end', () => resolve(JSON.parse(data.join(''))))
    })
    req.on('error', e => {
      console.error(`${url} failed: ${e.message}`)
      reject(e)
    })
    req.end()
  })
  return Promise.all([rateLimit(), call]).then(a => {
    apiCallTimes.push(Date.now())
    return a.pop()
  })
}

const protocols = new Map()

async function getProtocols(network) {
  if (protocols.has(network)) return
  const res = await oneInchAPI(chainIds.get(network), 'liquidity-sources', [])
  const names = res.protocols.map(x => x.id).filter(name => name !== 'ROCKET_POOL')
  protocols.set(network, names.join())
}

async function getQuote(network, fromETH, amount) {
  await getProtocols(network)
  const tokens = [rETHAddress.get(network), ETHAddress]
  if (fromETH) tokens.push(tokens.shift())
  const quoteParams = {
    fromTokenAddress: tokens[0],
    toTokenAddress: tokens[1],
    amount: amount.toString(),
    protocols: protocols.get(network)
  }
  return await oneInchAPI(chainIds.get(network), 'quote', quoteParams)
}

function getQuoteRatio(q) {
  return new Fraction(q.toTokenAmount.toString()).div(new Fraction(q.fromTokenAmount.toString()))
}

async function getSpot(network, fromETH) {
  console.log(`Getting spot for ${network} ${fromETH ? 'from ETH' : 'to ETH'}...`)
  const res = await getQuote(network, fromETH,
    ethers.utils.parseEther(network === 'mainnet' ? options.spotMainnet : options.spotLayer2))
  const spot = {
    network: network,
    fromTokenAmount: ethers.BigNumber.from(res.fromTokenAmount),
    fromTokenAddress: res.fromToken.address,
    toTokenAmount: ethers.BigNumber.from(res.toTokenAmount),
    toTokenAddress: res.toToken.address,
  }
  const ratio = getQuoteRatio(spot)
  console.log(`... got ${ratio}`)
  spot.ratio = ratio
  return spot
}

async function getSlippage(spot, amount) {
  console.log(`Getting slippage @ ${ethers.utils.formatEther(amount)}...`)
  const fromETH = spot.fromTokenAddress === ETHAddress
  const quote = await getQuote(spot.network, fromETH, amount)
  const quoteRatio = getQuoteRatio(quote)
  const slippage = quoteRatio.div(spot.ratio)
  console.log(`... got ${slippage}`)
  return {slippage: slippage, quote: quote}
}

const targetRatio = new Fraction('0.99')
const tolerance = new Fraction(`0.00${'0'.repeat(options.tolerance)}1`)

async function findOnePercentSlip(network, fromETH) {
  let spot = await getSpot(network, fromETH)
  let min = spot.fromTokenAmount.div(2)
  let max = spot.fromTokenAmount.mul(2)
  let slip
  while (true) {
    let maxSlip = await getSlippage(spot, max)
    let minSlip = undefined
    while (maxSlip.slippage.compare(targetRatio) >= 0) {
      min = max
      minSlip = maxSlip
      max = max.mul(2)
      console.log(`Max: ${ethers.utils.formatEther(max)}`)
      maxSlip = await getSlippage(spot, max)
    }
    if (minSlip === undefined)
      minSlip = await getSlippage(spot, min)
    while (minSlip.slippage.compare(targetRatio) <= 0) {
      min = min.div(2)
      console.log(`Min: ${ethers.utils.formatEther(min)}`)
      minSlip = await getSlippage(spot, min)
    }
    let queries = 0
    let amt = min
    slip = minSlip
    while (slip.slippage.sub(targetRatio).abs().compare(tolerance) > 0) {
      amt = min.add(max).div(2)
      console.log(`Amt: ${ethers.utils.formatEther(amt)}`)
      queries += 1
      slip = await getSlippage(spot, amt)
      if (slip.slippage.compare(targetRatio) <= 0) {
        max = amt
      }
      else {
        min = amt
      }
      if (queries > options.expiry)
        break
    }
    spot = await getSpot(network, fromETH)
    slip = await getSlippage(spot, amt)
    if (slip.slippage.sub(targetRatio).abs().compare(tolerance) <= 0)
      break
  }
  return {spot: spot, slip: slip}
}

async function findDatapoints(network) {
  const beforeTimestamp = Date.now()

  const fromETHSlip = await findOnePercentSlip(network, true)
  const fromETHAmount = fromETHSlip.slip.quote.fromTokenAmount
  const toETHSlip = await findOnePercentSlip(network, false)
  const toETHAmount = toETHSlip.slip.quote.toTokenAmount

  const afterTimestamp = Date.now()

  const timestamp = Math.floor((beforeTimestamp + afterTimestamp) / 2000)
  const filename = options.filename.replace('<network>', network)

  async function w(direction, amount) {
    const f = filename.replace('<direction>', direction)
    const l = `${timestamp},${amount.toString()}\n`
    console.log(`Appending to ${f}:`)
    process.stdout.write(l)
    await fs.writeFile(f, l, {flag: 'a'})
  }

  await w('ETH-to-rETH', fromETHAmount)
  await w('rETH-to-ETH', toETHAmount)
}

if (options.mainnet)
  await findDatapoints('mainnet')
if (options.arbitrum)
  await findDatapoints('arbitrum')
if (options.optimism)
  await findDatapoints('optimism')
if (options.polygon)
  await findDatapoints('polygon')
