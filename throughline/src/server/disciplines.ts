/**
 * Which disciplines an athlete has fitness in — the read behind the portal's
 * "Your sports" surface. An athlete's disciplines are implied by which anchors
 * they carry (run VDOT / bike FTP / swim CSS); this exposes that compactly so
 * the UI can show what's set and offer to add the rest — a discoverable,
 * incremental path from single-sport to triathlete WITHOUT nagging a runner who
 * only wants to run.
 */
import type { DB } from '@/db';
import type { Discipline } from '@/engine/plan';
import { getAthleteVdot } from '@/db/paceConfig';
import { getAthleteFtp } from '@/db/powerConfig';
import { getAthleteCss } from '@/db/swimConfig';

export interface DisciplineStatus {
  discipline: Discipline;
  anchorSet: boolean;
  /** Compact anchor label when set: "VDOT 48" · "FTP 240 W" · "CSS 1.30 m/s". */
  anchorLabel: string | null;
}

export interface AthleteDisciplines {
  statuses: DisciplineStatus[]; // always run, bike, swim in that order
  count: number; // how many disciplines have an anchor
}

export async function getAthleteDisciplines(db: DB, athleteId: string): Promise<AthleteDisciplines> {
  const [vdot, ftp, css] = await Promise.all([
    getAthleteVdot(db, athleteId),
    getAthleteFtp(db, athleteId),
    getAthleteCss(db, athleteId),
  ]);
  const statuses: DisciplineStatus[] = [
    { discipline: 'run', anchorSet: vdot != null, anchorLabel: vdot != null ? `VDOT ${Math.round(vdot)}` : null },
    { discipline: 'bike', anchorSet: ftp != null, anchorLabel: ftp != null ? `FTP ${Math.round(ftp)} W` : null },
    { discipline: 'swim', anchorSet: css != null, anchorLabel: css != null ? `CSS ${css.toFixed(2)} m/s` : null },
  ];
  return { statuses, count: statuses.filter((s) => s.anchorSet).length };
}
