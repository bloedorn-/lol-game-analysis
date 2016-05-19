const fs = require('fs')
const zlib = require('zlib')
const request = require('request')
const WebSocket = require('ws')
const fileExists = require('file-exists')
const _ = require('lodash')

function formatTime (ms) {
  let min = (ms/1000/60) << 0
  let sec = (ms/1000) % 60 << 0

  return min + ':' + (sec < 10 ? '0' : '') + sec
}

let games = {}

request('http://api.lolesports.com/api/issueToken', { json: true }, (err, res, body) => {
  if (err) throw err

  function connectToSocket () {
    // let ws = new WebSocket(`ws://livestats.proxy.lolesports.com/stats?jwt=${body.token}`)
    let ws = new WebSocket(`ws://localhost:8080`)

    ws.on('close', connectToSocket)

    ws.on('message', (msg) => {
      let json = {}
      try {
        json = JSON.parse(msg)
      } catch (e) {
        console.log('NON-JSON DATA')
        console.log(msg)
        console.error(e)
      }

      Object.keys(json).forEach((key) => {
        let game = json[key]

        if (!games[key]) {
          console.log(`adding game ${game.realm}-${key}`)
          let filePath = `${process.cwd()}/games/${game.realm}-${key}.json`
          games[key] = {
            stream: fs.createWriteStream(filePath, { flags: 'a' }),
            obj: game,
            id: `${game.realm}-${key}`,
            written: fileExists(filePath + '.gz')
          }

          games[key].stream.write(`[\n`)
        }

        if (games[key].written) {
          console.log(`finished file already exists for ${games[key].id} -- won't process again`)
          games[key].stream.destroy()
          return
        }

        console.log(`event received for game ${games[key].id} at time ${formatTime(game.t)}`)

        let isComplete = (game.gameComplete || false)
        // don't bother writing the data for the first frames where player pos are 0
        let merged = _.merge(games[key].obj, game)
        if (merged.playerStats['1'].x !== 0) {
          games[key].obj = merged
          games[key].stream.write(JSON.stringify(games[key].obj) + (isComplete ? '\n' : ',\n'))
        }

        if (isComplete) {
          console.log(`finished game ${games[key].id} at time ${formatTime(game.t)}! finishing up...`)

          games[key].stream.end(']\n', () => {
            games[key].stream.destroy()

            let filePath = `${process.cwd()}/games/${games[key].id}.json`
            let gzip = zlib.createGzip({ level: 9 })

            fs.createReadStream(filePath).pipe(gzip).pipe(fs.createWriteStream(filePath + '.gz').on('close', () => {
              games[key].written = true
              console.log(`wrote gzipped file for ${games[key].id}`)
              // upload logic
            }))
          })
        }
      })
    })
  }

  connectToSocket()
})