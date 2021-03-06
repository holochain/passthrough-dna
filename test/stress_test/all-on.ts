import { Config } from '@holochain/tryorama'
import * as R from 'ramda'
import { Batch } from '@holochain/tryorama-stress-utils'



const trace = R.tap(x => console.log('{T}', x))

module.exports = (scenario, configBatch, N, C, I) => {
  const totalInstances = N*C*I
  const totalConductors = N*C
    scenario('one at a time', async (s, t) => {
      const configs = configBatch(totalConductors, I)
      let  p =   await s.players(configs, true)
      const players = R.sortBy(p => parseInt(p.name, 10), R.values(p))
      const batch = new Batch(players).iteration('series')

    // Make every instance of every conductor commit an entry
      const commitResults = await batch.mapInstances(instance =>
      instance.call('main', 'commit_entry', { content: trace(`entry-${instance.player.name}-${instance.id}`) })
    )
    const hashes = commitResults.map(x => x.Ok)

    // All results are Ok (not Err)
    t.deepEqual(commitResults.map(x => x.Err), R.repeat(undefined, totalInstances))
    t.ok(hashes.every(R.identity))

    await s.consistency()

    // Make one instance commit an entry as a base and link every previously committed entry as a target
    const instance1 = await players[0]._instances["0"]
    console.log("INSTANCE 1",instance1)
    const baseHash = await instance1.call('main', 'commit_entry', { content: 'base' }).then(r => r.Ok)
    let addLinkResults = []
    for (const hash of hashes) {
      const result = await instance1.call('main', 'link_entries', { base: baseHash, target: hash })
      addLinkResults.push(result)
    }

    await s.consistency()

    t.ok(addLinkResults.every(r => r.Ok))
    t.equal(addLinkResults.length, totalInstances)
    t.deepEqual(addLinkResults.map(x => x.Err), R.repeat(undefined, totalInstances))

    // Make each other instance getLinks on the base hash

    const getLinksResults = await batch.mapInstances(instance => instance.call('main', 'get_links', { base: baseHash }))

    // All getLinks results contain the full set
      t.deepEqual(getLinksResults.map(r => r.Ok.links.length), R.repeat(totalInstances, totalInstances))
  })

  scenario.skip('all at once', async (s, t) => {
    const players = R.sortBy(p => parseInt(p.name, 10), R.values(await s.players(configBatch(totalConductors, I), true)))
    const batch = new Batch(players).iteration('parallel')

    const commitResults = await batch.mapInstances(instance =>
      instance.call('main', 'commit_entry', { content: trace(`entry-${instance.player.name}-${instance.id}`) })
    )
    const hashes = commitResults.map(x => x.Ok)

    // All results are Ok (not Err)
    t.deepEqual(commitResults.map(x => x.Err), R.repeat(undefined, totalInstances))
    t.ok(hashes.every(R.identity))

    await s.consistency()

    const instance1 = await players[0]._instances['0']
    const baseHash = await instance1.call('main', 'commit_entry', { content: 'base' }).then(r => r.Ok)
    const addLinkResults: Array<any> = await Promise.all(
      hashes.map(hash => instance1.call('main', 'link_entries', { base: baseHash, target: hash }))
    )

    t.ok(addLinkResults.every(r => r.Ok))
    t.equal(addLinkResults.length, totalInstances)
    t.deepEqual(addLinkResults.map(x => x.Err), R.repeat(undefined, totalInstances))

    await s.consistency()

    const getLinksResults = await batch.mapInstances(instance => instance.call('main', 'get_links', { base: baseHash }))

    // All getLinks results contain the full set
    t.deepEqual(getLinksResults.map(r => r.Ok.links.length), R.repeat(totalInstances, totalInstances))
  })
}
