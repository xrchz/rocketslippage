import { ethers } from './ethers-6.6.2.min.js'
const query = new URLSearchParams(location.search)
const canonicalTokens = new Map()
canonicalTokens.set('RETH', 'rETH')
canonicalTokens.set('RPL', 'RPL')
if (!canonicalTokens.has((query.get('token') || '').toUpperCase())) {
  query.set('token', 'rETH')
  location.search = query
}
else if (!Array.from(canonicalTokens.values()).includes(query.get('token'))) {
  query.set('token', canonicalTokens.get(query.get('token').toUpperCase()))
  location.search = query
}
const token = query.get('token')
const srcSection = document.createElement('section')
srcSection.classList.add('src')
const srcA = srcSection.appendChild(document.createElement('a'))
srcA.innerText = 'code + data'
srcA.href = 'https://github.com/xrchz/rocketslippage'
const avgSection = document.createElement('section')
const allSection = document.createElement('section')
avgSection.appendChild(document.createElement('h2')).innerText = 'Average'
allSection.appendChild(document.createElement('h2')).innerText = 'Both directions'
const tables = []
const avgChartCanvas = avgSection.appendChild(document.createElement('canvas'))
const allChartCanvas = allSection.appendChild(document.createElement('canvas'))
const directions = [
  `ETH-to-${token}`,
  `${token}-to-ETH`
]
const filesPerToken = new Map()
filesPerToken.set('rETH', [
  '1%-1Inch-mainnet',
  '1%-1Inch-optimism',
  '1%-1Inch-arbitrum',
  '1%-uniswap-polygon'
])
filesPerToken.set('RPL', ['1%-1Inch-mainnet'])
const files = filesPerToken.get(token)
const scaleFactor = [1n, 1n, 1n, 100n]
const options = {
  scales: {
    x: {
      type: 'time',
      time: {
        unit: 'day'
      }
    },
    y: {
      type: 'linear',
      title: {
        display: true,
        text: 'ETH'
      }
    }
  },
  plugins: {
    zoom: {
      zoom: {
        drag: {
          enabled: true
        },
        pinch: {
          enabled: true
        }
      }
    }
  }
}
const allChart = new Chart(allChartCanvas, {type: 'line', data: {datasets: []}, options: options})
const resetAllChart = allSection.appendChild(document.createElement('input'))
resetAllChart.type = 'button'
resetAllChart.value = 'reset zoom'
resetAllChart.addEventListener('click', () => allChart.resetZoom())
const avgChart = new Chart(avgChartCanvas, {type: 'line', data: {datasets: []}, options: options})
const resetAvgChart = avgSection.appendChild(document.createElement('input'))
resetAvgChart.type = 'button'
resetAvgChart.value = 'reset zoom'
resetAvgChart.addEventListener('click', () => avgChart.resetZoom())
for (const [networkIndex, filename] of files.entries()) {
  const avg = []
  for (const direction of directions) {
    const fullname = `${direction}-${filename}`
    const file = await fetch(`${fullname}.csv`)
    const contents = await file.text()
    const lines = contents.split('\n')
    lines.shift()
    lines.pop()
    const rawData = lines.map(line => {
      const [timestampSecs, wei] = line.split(',')
      return [parseInt(timestampSecs), BigInt(wei)]
    })
    const data = rawData.map(d => {
      const [timestampSecs, wei] = d
      return {x: timestampSecs * 1000,
              y: ethers.formatEther(wei)}
    })
    avg.push(rawData)
    allChart.data.datasets.push({label: fullname, data: data})
    const table = document.createElement('table')
    const thead = table.appendChild(document.createElement('thead'))
    const tr = thead.appendChild(document.createElement('tr'))
    tr.appendChild(document.createElement('th')).innerText = 'Date'
    tr.appendChild(document.createElement('th')).innerText = `ETH for ${fullname}`
    const tbody = table.appendChild(document.createElement('tbody'))
    data.forEach(d => {
      const date = new Date(d.x)
      const tr = document.createElement('tr')
      const td = tr.appendChild(document.createElement('td'))
      const d2 = n => n.toString().padStart(2, '0')
      td.innerText = `${d2(date.getDate())}/${d2(date.getMonth()+1)}/${date.getFullYear()}`
      td.title = date.toUTCString()
      tr.appendChild(document.createElement('td')).innerText = d.y
      tbody.appendChild(tr)
    })
    tables.push(table)
  }
  const rawData = avg[0].map(d =>
    ({x: d[0] * 1000, y: 0n}))
  avg.forEach(row => {
    row.forEach((d, i) => {
      rawData[i].y += d[1]
    })
  })
  const sf = scaleFactor[networkIndex]
  const data = rawData.map(d =>
    ({x: d.x, y: ethers.formatEther(d.y * sf / 2n)}))
  avgChart.data.datasets.push({label: `${sf}×${token}-${filename}`, data: data})
}
allChart.update()
avgChart.update()
const body = document.querySelector('body')
body.appendChild(srcSection)
body.appendChild(avgSection)
body.appendChild(allSection)
const tablesSection = allSection.appendChild(document.createElement('section'))
tablesSection.classList.add('tables')
tablesSection.appendChild(document.createElement('h3')).innerText = 'Tables'
tables.forEach(t => tablesSection.appendChild(t))
