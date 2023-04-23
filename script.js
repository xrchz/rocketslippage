import { ethers } from './ethers-5.7.esm.min.js'
const charts = document.querySelector('body').appendChild(document.createElement('div'))
const files = [
  'ETH-to-rETH-1%-1Inch-mainnet',
  'rETH-to-ETH-1%-1Inch-mainnet'
]
files.forEach(async filename => {
  const file = await fetch(`${filename}.csv`)
  const contents = await file.text()
  const lines = contents.split('\n')
  lines.shift()
  lines.pop()
  const data = lines.map(line => {
    const [timestamp, wei] = line.split(',')
    return {x: parseInt(timestamp) * 1000,
            y: ethers.utils.formatEther(ethers.BigNumber.from(wei))}
  })
  const chart = charts.appendChild(document.createElement('canvas'))
  new Chart(chart, {
    type: 'line',
    data: {
      datasets: [{label: filename, data: data}]
    },
    options: {
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
  })
  const table = document.createElement('table')
  const thead = table.appendChild(document.createElement('thead'))
  const tr = thead.appendChild(document.createElement('tr'))
  tr.appendChild(document.createElement('th')).innerText = 'Date'
  tr.appendChild(document.createElement('th')).innerText = 'ETH'
  const tbody = table.appendChild(document.createElement('tbody'))
  data.forEach(d => {
    const date = new Date(d.x)
    const tr = document.createElement('tr')
    const td = tr.appendChild(document.createElement('td'))
    td.innerText = `${date.getDate()}/${date.getMonth()+1}/${date.getFullYear()}`
    tr.appendChild(document.createElement('td')).innerText = d.y
    tbody.appendChild(tr)
  })
  charts.appendChild(table)
})
