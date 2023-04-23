import { ethers } from './ethers-5.7.esm.min.js'
const div = document.createElement('div')
const tables = []
const avgChartCanvas = div.appendChild(document.createElement('canvas'))
const allChartCanvas = div.appendChild(document.createElement('canvas'))
const directions = [
  'ETH-to-rETH',
  'rETH-to-ETH'
]
const files = [
  '1%-1Inch-mainnet',
  '1%-1Inch-optimism',
  '1%-1Inch-arbitrum'
]
const scaleFactor = [1, 1, 100]
const options = {
  scales: {
    x: {
      type: 'time',
      time: {
        unit: 'day'
      }
    },
    y: {
      type: 'linear'
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
    tr.appendChild(document.createElement('th')).innerText = `ETH for ${filename}`
    const tbody = table.appendChild(document.createElement('tbody'))
    data.forEach(d => {
      const date = new Date(d.x)
      const tr = document.createElement('tr')
      const td = tr.appendChild(document.createElement('td'))
      td.innerText = `${date.getDate()}/${date.getMonth()+1}/${date.getFullYear()}`
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
body.appendChild(div)
tables.forEach(t => body.appendChild(t))
