#!/usr/bin/env node

const logTime = () => Intl.DateTimeFormat('en-GB',
  {year: '2-digit', month: '2-digit', day: '2-digit',
   hour: '2-digit', minute: '2-digit', second: '2-digit'})
  .format(new Date())

import 'dotenv/config'
import { program, Option } from 'commander'
import { ethers } from 'ethers'
import * as https from 'node:https'
import Fraction from 'fraction.js'
import * as fs from 'node:fs/promises'

const ETHAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const allTokenAddresses = {rETH: new Map(), RPL: new Map()}
allTokenAddresses['rETH'].set('mainnet', '0xae78736Cd615f374D3085123A210448E74Fc6393')
allTokenAddresses['rETH'].set('arbitrum', '0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8')
allTokenAddresses['rETH'].set('optimism', '0x9bcef72be871e61ed4fbbc7630889bee758eb81d')
allTokenAddresses['rETH'].set('polygon', '0x0266F4F08D82372CF0FcbCCc0Ff74309089c74d1')
allTokenAddresses['RPL'].set('mainnet', '0xD33526068D116cE69F19A9ee46F0bd304F21A51f')
allTokenAddresses['RPL'].set('arbitrum', '0xB766039cc6DB368759C1E56B79AFfE831d0Cc507')
allTokenAddresses['RPL'].set('optimism', '0xc81d1f0eb955b0c020e5d5b264e1ff72c14d1401')
allTokenAddresses['RPL'].set('polygon', '0x7205705771547cf79201111b4bd8aaf29467b9ec')


const chainIds = new Map()
chainIds.set('mainnet', 1)
chainIds.set('arbitrum', 42161)
chainIds.set('optimism', 10)
chainIds.set('polygon', 137)

program
  .addOption(new Option('--token <sym>', 'token to collect ETH paired liquidity for').choices(['rETH', 'RPL']).default('rETH'))
  .option('--no-mainnet', 'skip mainnet')
  .option('--no-optimism', 'skip optimism')
  .option('--no-arbitrum', 'skip arbitrum')
  .option('--polygon', 'do not skip polygon')
  .option('--oneInchAPI <url>', '1Inch API base URL', 'https://api.1inch.dev/swap/v5.2')
  .option('--tolerance <zeros>', 'How precise to be about 1%: number of zeros needed in 0.99[00000...]', 2)
  .option('--filename <template>', 'Template for files to append csv datapoints to', '../<direction>-1%-1Inch-<network>.csv')
  .option('--expiry <queries>', 'Maximum number of binary search steps before refreshing spot', 10)
  .option('--spot-mainnet', 'ETH amount for spot price on mainnet', '10')
  .option('--spot-layer2', 'ETH amount for spot price on not mainnet', '1')

program.parse()
const options = program.opts()

const tokenAddress = allTokenAddresses[options.token]

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
    const req = https.get(url, {headers: {'Authorization': `Bearer ${process.env.API_KEY}`}}, res => {
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
  const tokens = [tokenAddress.get(network), ETHAddress]
  if (fromETH) tokens.push(tokens.shift())
  const quoteParams = {
    src: tokens[0],
    dst: tokens[1],
    amount: amount.toString(),
    protocols: protocols.get(network)
  }
  const res = await oneInchAPI(chainIds.get(network), 'quote', quoteParams)
  res.fromAmount = amount
  res.fromToken = {address: quoteParams.src}
  res.toToken = {address: quoteParams.dst}
  return res
}

function getQuoteRatio(q) {
  return new Fraction(q.toAmount.toString()).div(new Fraction(q.fromAmount.toString()))
}

async function getSpot(network, fromETH) {
  console.log(`${logTime()} Getting spot for ${options.token} on ${network} ${fromETH ? 'from ETH' : 'to ETH'}...`)
  const res = await getQuote(network, fromETH,
    ethers.utils.parseEther(network === 'mainnet' ? options.spotMainnet : options.spotLayer2))
  const spot = {
    network: network,
    fromAmount: ethers.BigNumber.from(res.fromAmount),
    fromTokenAddress: res.fromToken.address,
    toAmount: ethers.BigNumber.from(res.toAmount),
    toTokenAddress: res.toToken.address,
  }
  const ratio = getQuoteRatio(spot)
  console.log(`... got ${ratio}`)
  spot.ratio = ratio
  return spot
}

async function getSlippage(spot, amount) {
  console.log(`${logTime()} Getting slippage @ ${ethers.utils.formatEther(amount)}...`)
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
  let min = spot.fromAmount.div(2)
  let max = spot.fromAmount.mul(2)
  let slip
  while (true) {
    let maxSlip = await getSlippage(spot, max)
    let minSlip = undefined
    while (maxSlip.slippage.compare(targetRatio) >= 0) {
      min = max
      minSlip = maxSlip
      max = max.mul(2)
      maxSlip = await getSlippage(spot, max)
    }
    if (minSlip === undefined)
      minSlip = await getSlippage(spot, min)
    while (minSlip.slippage.compare(targetRatio) <= 0) {
      min = min.div(2)
      minSlip = await getSlippage(spot, min)
    }
    let queries = 0
    let amt = min
    slip = minSlip
    while (slip.slippage.sub(targetRatio).abs().compare(tolerance) > 0) {
      amt = min.add(max).div(2)
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
  const fromETHAmount = fromETHSlip.slip.quote.fromAmount
  const toETHSlip = await findOnePercentSlip(network, false)
  const toETHAmount = toETHSlip.slip.quote.toAmount

  const afterTimestamp = Date.now()

  const timestamp = Math.floor((beforeTimestamp + afterTimestamp) / 2000)
  const filename = options.filename.replace('<network>', network)

  async function w(direction, amount) {
    const f = filename.replace('<direction>', direction)
    const l = `${timestamp},${amount.toString()}\n`
    console.log(`${logTime()} Appending to ${f}:`)
    process.stdout.write(l)
    await fs.writeFile(f, l, {flag: 'a'})
  }

  await w(`ETH-to-${options.token}`, fromETHAmount)
  await w(`${options.token}-to-ETH`, toETHAmount)
}

if (options.mainnet)
  await findDatapoints('mainnet')
if (options.arbitrum)
  await findDatapoints('arbitrum')
if (options.optimism)
  await findDatapoints('optimism')
if (options.polygon)
  await findDatapoints('polygon')
