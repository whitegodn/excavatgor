import { DEG, wrapAngle } from '../../core/sim/math';
import type { ExcavatorSim } from '../../equipment/excavator/excavatorSim';
import type { Zone } from '../../sites/site';
import type { Marker } from '../task';
import { CycleObjective } from './cycleObjective';

const k = (name: string) => `<kbd>${name}</kbd>`;
/** 구역 가운데가 이 거리 안에 들어오면 선회와 암으로 닿는다 */
const REACH = 7.5;

/**
 * 흙을 담아 멀리 떨어진 곳까지 몰고 가서 쏟는 과제.
 * 굴착 사이클과 판정은 같고, 가야 할 구역의 방향과 거리를 알려 주는 것만 다르다.
 */
export class HaulObjective extends CycleObjective {
  private way(sim: ExcavatorSim, zone: Zone, name: string): string | null {
    const dx = (zone.x0 + zone.x1) / 2 - sim.x;
    const dz = (zone.z0 + zone.z1) / 2 - sim.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= REACH) return null;
    const turn = wrapAngle(Math.atan2(dx, dz) - sim.heading) / DEG;
    const dir =
      Math.abs(turn) < 10
        ? `정면 ${k('↑')}`
        : Math.abs(turn) > 150
          ? `바로 뒤쪽 · 후진 ${k('↓')}으로 가도 됩니다`
          : `차체를 ${turn < 0 ? '왼쪽' : '오른쪽'}으로 ${Math.abs(turn).toFixed(0)}° ${turn < 0 ? k('←') : k('→')}`;
    return `${name}까지 ${dist.toFixed(0)}m · ${dir}`;
  }

  brief(sim: ExcavatorSim): string {
    const count = `${Math.min(sim.cycles, this.cycles)}/${this.cycles}회`;
    const loaded = sim.load > 0.25 * sim.spec.bucketCapacity;
    if (loaded) {
      const go = this.way(sim, sim.site.dumpZone, '파란 구역');
      return go
        ? `흙을 실었습니다. ${go}<small>버킷을 든 채 방향키로 몰고 가세요. 흙을 실었을 때는 저속 단으로 다니세요 (${count})</small>`
        : `파란 구역에 닿는 거리입니다. 선회해서 버킷을 파란 구역 위로 옮겨 쏟으세요<small>${count}</small>`;
    }
    const back = this.way(sim, sim.site.digZone, '노란 구역');
    if (back) return `${back}<small>노란 구역으로 돌아가 다음 흙을 담으세요 (${count})</small>`;
    // 노란 구역에 닿는 거리인데 버킷이 다른 쪽을 보고 있으면 선회 방향을 알려 준다
    const z = sim.site.digZone;
    const swing = wrapAngle(Math.atan2((z.x0 + z.x1) / 2 - sim.x, (z.z0 + z.z1) / 2 - sim.z) - (sim.heading + sim.swing)) / DEG;
    if (Math.abs(swing) > 15) {
      return `노란 구역에 닿는 거리입니다. ${swing < 0 ? `왼쪽으로 선회해(${k('A')})` : `오른쪽으로 선회해(${k('D')})`} 버킷을 노란 구역 위로 옮기세요 ${Math.abs(swing).toFixed(0)}°<small>${count}</small>`;
    }
    return `노란 구역의 흙을 담으세요. 담은 뒤에는 파란 구역까지 몰고 갑니다<small>${count} · 파란 구역 위에 뜬 공이 쏟을 자리입니다</small>`;
  }

  markers(sim: ExcavatorSim): Marker[] {
    const z = sim.site.dumpZone;
    const loaded = sim.load > 0.25 * sim.spec.bucketCapacity;
    return [
      ...super.markers(sim),
      { kind: 'target', x: (z.x0 + z.x1) / 2, y: 3.2, z: (z.z0 + z.z1) / 2, radius: 0.8, state: loaded ? 'active' : 'todo' },
    ];
  }
}
