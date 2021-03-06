import { Config } from '@holochain/tryorama'
import * as R from 'ramda'
import { Batch } from '@holochain/tryorama-stress-utils'


const trace = R.tap(x => console.log('{T}', x))
const delay = ms => new Promise(r => setTimeout(r, ms))

module.exports = (scenario, configBatch, N, C, I, testConfig) => {
    const totalInstances = N*C*I
    const totalConductors = N*C

    let spinUpDelay = 0
    let retryDelay = 10000
    let retries = 3
    let commitCount = 0
    if (testConfig.retryDelay != undefined) {
        testConfig.retryDelay
    }
    if (testConfig.retries != undefined) {
        retries = testConfig.retries
    }
    if (testConfig.spinUpDelay != undefined) {
        spinUpDelay = testConfig.spinUpDelay
    }
    if (testConfig.commitCount != undefined) {
        commitCount = testConfig.commitCount
    }

    scenario('all hashes are available somewhere gettable', async (s, t) => {
        const players = R.sortBy(p => parseInt(p.name, 10), R.values(await s.players(configBatch(totalConductors, I), false)))

        // range of random number of milliseconds to wait before startup
        // const startupSpacing = 10000
        // number of milliseconds to wait between gets
        const getWait = 20

        await Promise.all(players.map(async player => {
            //await delay(Math.random()*startupSpacing)
            return player.spawn()
        }))
        console.log("============================================\nall nodes have started\n============================================")
        console.log(`beginning dht sanity test`)
        if (spinUpDelay == 0) {
            console.log("no spin-up delay given using tryorama consistency waiting")
            await s.consistency()
        } else {
            console.log(`spin up delay ${spinUpDelay}`)
            await delay(spinUpDelay)
        }

        let batch = new Batch(players).iteration('parallel')
        if (commitCount > 0) {
            console.log(`asking all nodes to commit ${commitCount} entries`)
            let i = 0
            while (i < commitCount) {
                i+=1
                // Make every instance of every conductor commit an entry
                const commitResults = await batch.mapInstances(instance =>
                                                               instance.call('main', 'commit_entry', { content: trace(`entry-${instance.player.name}-${instance.id}-${i}`) })
                                                              )
                const hashes = commitResults.map(x => x.Ok)
                console.log(`commit result ${hashes}`)
            }
        }

        batch.iteration('series')
        const agentAddresses = await batch.mapInstances(async instance => instance.agentAddress)
        const agentSet = new Set(agentAddresses)
        console.log('agentAddresses: ', agentAddresses.length, JSON.stringify(agentAddresses))
        console.log('agentSet: ', agentSet.size, JSON.stringify(Array.from(agentSet)))

        let tries = 0
        while (tries < retries) {
            tries += 1
            console.log(`Checking holding: try ${tries}`)
            const dht_state = await getDHTstate(batch)
            const {missing, held_by} = checkHolding(dht_state)
            if (missing == 0) {
                console.log("all are held")
                t.pass()
                break
            }
            console.log(`all not held missing: ${missing}, retrying after delay`)
            await delay(retryDelay)
        }
        if (tries == retries) {
            t.fail()
        }
    })
}

function checkHolding(dht_state) {
    let missing = 0
    let held_by = {}
    console.log("total number of entries returned by state dumps:", dht_state["entries"].length)
    for (const entry_address of dht_state["entries"]) {
        let holders = []
        for (const holding of dht_state["holding"]) {
            if (holding.held_addresses.includes(entry_address)) {
                holders.push(holding.agent_address)
            }
        }
        held_by[entry_address] = holders
        console.log(`${entry_address} is held by ${holders.length} agents`)
        if (holders.length === 0) {
            missing += 1
        }
    }
    return {missing, held_by}
}

const getDHTstate = async (batch: Batch) => {
    let entries_map = {}
    const holding_map = await batch.mapInstances(async instance => {
        const id = `${instance.id}:${instance.agentAddress}`
        console.log(`calling state dump for instance ${id})`)
        const dump = await instance.stateDump()
        const held_addresses = R.keys(dump.held_aspects)
        const sourceChain = R.values(dump.source_chain)
        const entryMap = {}
        for (const entry of sourceChain) {
            if (entry.entry_type != "Dna" && entry.entry_type != "CapTokenGrant") {
                entries_map[entry.entry_address] = true
            }
        }
        return {
            instance_id: instance.id,
            held_addresses,
            agent_address: instance.agentAddress
        }
    })
    return {
        entries: R.keys(entries_map),
        holding: holding_map
    }
}
