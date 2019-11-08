import { Config } from '@holochain/try-o-rama'
import * as R from 'ramda'

const { Orchestrator, tapeExecutor, singleConductor, combine, localOnly, machinePerPlayer } = require('@holochain/try-o-rama')

process.on('unhandledRejection', error => {
  console.error('got unhandledRejection:', error);
});

const networkType = process.env.APP_SPEC_NETWORK_TYPE || 'sim2h_public'
let network = null

// default middleware is localOnly
let middleware = combine(tapeExecutor(require('tape')), localOnly)

switch (networkType) {
  case 'memory':
    network = 'memory'
    middleware = combine(singleConductor, tapeExecutor(require('tape')))
    break
  case 'sim1h':
    network = {
      type: 'sim1h',
      dynamo_url: "http://localhost:8000",
    }
    middleware = tapeExecutor(require('tape'))
    break
  case 'sim2h':
    network = {
      type: 'sim2h',
      sim2h_url: "wss://localhost:9002",
    }
    middleware = tapeExecutor(require('tape'))
    break
  case 'sim2h_public':
      network = {
          type: 'sim2h',
          sim2h_url: "wss://sim2h.holochain.org:9000",
      }
      break
  default:
    throw new Error(`Unsupported network type: ${networkType}`)
}

if (process.env.HC_TRANSPORT_CONFIG) {
    network=require(process.env.HC_TRANSPORT_CONFIG)
    console.log("setting network from:"+process.env.HC_TRANSPORT_CONFIG)
}

// default stress test is local (because there are no endpoints specified)
let stress_config = {
    conductors: 10,
    instances: 1,
    endpoints: undefined
}

// first arg is the path to a stress test config file
if (process.argv[2]) {
    stress_config=require(process.argv[2])
}


const dnaLocal = Config.dna('../dist/passthrough-dna.dna.json', 'passthrough')
const dnaRemote = Config.dna('https://github.com/holochain/passthrough-dna/releases/download/v0.0.6/passthrough-dna.dna.json', 'passthrough')
let chosenDna = dnaLocal;

/** Builder function for a function that generates a bunch of identical conductor configs
 with multiple identical instances */
const makeBatcher = dna => (numConductors, numInstances) => {
    const conductor = R.pipe(
        R.map(n => [`${n}`, dna]),
        R.fromPairs,
        x => ({ instances: x }),
    )(R.range(0, numInstances))
    return R.repeat(conductor, numConductors)
}

// if there are endpoints specified then we use the machinePerPlayer middleware so try-o-rama
// knows to connect to trycp on those endpoints for running the tests
if (stress_config.endpoints) {
    chosenDna = dnaRemote
    middleware = combine(tapeExecutor(require('tape')), machinePerPlayer(stress_config.endpoints))
}
console.log("using dna: "+ JSON.stringify(chosenDna))
console.log("using network: "+ JSON.stringify(network))
const orchestrator = new Orchestrator({
    middleware,
    globalConfig: {
        network,
        logger: true
    }
})

const batcher = makeBatcher(chosenDna)

console.log(`Running stress tests with N=${stress_config.conductors}, M=${stress_config.instances}`)

require('./all-on')(orchestrator.registerScenario, batcher, stress_config.conductors, stress_config.instances)

orchestrator.run()