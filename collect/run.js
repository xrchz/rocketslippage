#!/usr/bin/env node

import { program } from 'commander'
import { ethers } from 'ethers'
import * as https from 'node:https'

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
  .option('--oneInchAPI <url>', '1Inch API base URL', 'https://api.1inch.io/v5.0/')

program.parse()

function oneInchAPI(chainId, method, query) {
  const queryString = new URLSearchParams(query).toString()
  const url = `${options.oneInchAPI}/${chainId}/${method}?${queryString}`

}

const protocols = new Map()

async function getProtocols(network) {
  if (protocols.has(network)) return
  const vs = await https.get(url)
  protocols.set(network, vs)
}

async function getQuote(network, fromETH) {
  const quoteParams = {

  }
}
