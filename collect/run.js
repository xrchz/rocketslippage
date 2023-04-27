#!/usr/bin/env node

import { program } from 'commander'
import { ethers } from 'ethers'
import * as https from 'node:https'
import Fraction from 'fraction.js'

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
  .option('--rateLimit <millis>', 'How many milliseconds to space API calls out by', 1000)
  .option('--spot-mainnet', 'ETH amount for spot price on mainnet', '10')
  .option('--spot-layer2', 'ETH amount for spot price on not mainnet', '1')

program.parse()
const options = program.opts()

let milliseconds = Date.now()

function oneInchAPI(chainId, method, query) {
  const queryString = new URLSearchParams(query).toString()
  const url = `${options.oneInchAPI}/${chainId}/${method}?${queryString}`
  const wait = new Promise(resolve => {
    const lastMilliseconds = milliseconds
    milliseconds = Date.now()
    const diff = lastMilliseconds - milliseconds
    setTimeout(resolve, diff < options.rateLimit ? options.rateLimit - diff : 1)
  })
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
  return Promise.all([wait, call]).then(a => a.pop())
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
  return slippage
}

const targetRatio = new Fraction('0.99')
const tolerance = new Fraction(`0.00${'0'.repeat(options.tolerance)}1`)

async function findOnePercentSlippageAmounts(network, fromETH) {
  let spot = await getSpot(network, fromETH)
  let min = spot.fromTokenAmount.div(2)
  let max = spot.fromTokenAmount.mul(2)
  let amt
  while (true) {
    let slippage
    slippage = await getSlippage(spot, max)
    while (slippage.compare(targetRatio) >= 0) {
      min = max
      max = max.mul(2)
      console.log(`Max: ${ethers.utils.formatEther(max)}`)
      slippage = await getSlippage(spot, max)
    }
    /* unnecessary?
    slippage = await getSlippage(spot, min)
    while (slippage.compare(targetRatio) <= 0) {
      min = min.div(2)
      console.log(`Min: ${ethers.utils.formatEther(min)}`)
      slippage = await getSlippage(spot, min)
    }
    */
    amt = min
    while (slippage.sub(targetRatio).abs().compare(tolerance) > 0) {
      amt = min.add(max).div(2)
      console.log(`Amt: ${ethers.utils.formatEther(amt)}`)
      slippage = await getSlippage(spot, amt)
      if (slippage.compare(targetRatio) <= 0) {
        max = amt
      }
      else {
        min = amt
      }
    }
    spot = await getSpot(network, fromETH)
    slippage = await getSlippage(spot, amt)
    if (slippage.sub(targetRatio).abs().compare(tolerance) <= 0)
      break
  }
  return {spot: spot, amount: amt, timestamp: Math.floor(Date.now() / 1000)}
}

// console.log(JSON.stringify(await findOnePercentSlippageAmounts('mainnet', false)))
// console.log(JSON.stringify(await findOnePercentSlippageAmounts('mainnet', true)))

/*
const mainnetSpot = await getSpot('mainnet', false)
const mainnetSpotRatio = new Fraction(mainnetSpot.toTokenAmount.toString()).div(new Fraction(mainnetSpot.fromTokenAmount.toString()))
console.log(`Mainnet spot ratio rETH->ETH: ${mainnetSpot.toTokenAmount}/${mainnetSpot.fromTokenAmount} = ${mainnetSpotRatio}`)
console.log(`Slippage @ 100 ETH: ${await getSlippage(mainnetSpot, ethers.utils.parseEther('100'))}`)
console.log(`Slippage @ 1000 ETH: ${await getSlippage(mainnetSpot, ethers.utils.parseEther('1000'))}`)
console.log(`Slippage @ 10000 ETH: ${await getSlippage(mainnetSpot, ethers.utils.parseEther('10000'))}`)
console.log(`Slippage @ 20000 ETH: ${await getSlippage(mainnetSpot, ethers.utils.parseEther('20000'))}`)
console.log(`Slippage @ 50000 ETH: ${await getSlippage(mainnetSpot, ethers.utils.parseEther('50000'))}`)
console.log(`Slippage @ 100000 ETH: ${await getSlippage(mainnetSpot, ethers.utils.parseEther('100000'))}`)

const mainnetSpotR = await getSpot('mainnet', true)
const mainnetSpotRatioR = new Fraction(mainnetSpotR.toTokenAmount.toString()).div(new Fraction(mainnetSpotR.fromTokenAmount.toString()))
console.log(`Mainnet spot ratio ETH->rETH: ${mainnetSpotR.toTokenAmount}/${mainnetSpotR.fromTokenAmount} = ${mainnetSpotRatioR}`)
*/

/*
const optimismSpot = await getSpot('optimism', false)
console.log(`Optimism spot ratio rETH->ETH: ${optimismSpot.toTokenAmount}/${optimismSpot.fromTokenAmount}`)
*/
