const app = require('./app')
const { port } = require('./config')

app.listen(port, () => {
  console.log(`LLD API listening on http://localhost:${port}`)
})