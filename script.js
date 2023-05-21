import { ethers } from './ethers-5.7.esm.min.js'
const srcSection = document.createElement('section')
srcSection.classList.add('src')
const srcA = srcSection.appendChild(document.createElement('a'))
srcA.innerText = 'code + data'
srcA.href = 'https://github.com/xrchz/rETH-slippage'
const avgSection = document.createElement('section')
const allSection = document.createElement('section')
avgSection.appendChild(document.createElement('h2')).innerText = 'Average'
allSection.appendChild(document.createElement('h2')).innerText = 'Both directions'
const tables = []
const avgChartCanvas = avgSection.appendChild(document.createElement('canvas'))
const allChartCanvas = allSection.appendChild(document.createElement('canvas'))
const directions = [
  'ETH-to-rETH',
  'rETH-to-ETH'
]
const files = [
  '1%-1Inch-mainnet',
  '1%-1Inch-optimism',
  '1%-1Inch-arbitrum',
  '1%-uniswap-polygon'
]
const scaleFactor = [1, 1, 10, 100]
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
  }
}
const allChart = new Chart(allChartCanvas, {type: 'line', data: {datasets: []}, options: options})
const avgChart = new Chart(avgChartCanvas, {type: 'line', data: {datasets: []}, options: options})
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
      return [parseInt(timestampSecs), ethers.BigNumber.from(wei)]
    })
    const data = rawData.map(d => {
      const [timestampSecs, wei] = d
      return {x: timestampSecs * 1000,
              y: ethers.utils.formatEther(wei)}
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
    ({x: d[0] * 1000, y: ethers.BigNumber.from(0)}))
  avg.forEach(row => {
    row.forEach((d, i) => {
      rawData[i].y = rawData[i].y.add(d[1])
    })
  })
  const sf = scaleFactor[networkIndex]
  const data = rawData.map(d =>
    ({x: d.x, y: ethers.utils.formatEther(d.y.mul(sf).div(2))}))
  avgChart.data.datasets.push({label: `${sf}×${filename}`, data: data})
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
