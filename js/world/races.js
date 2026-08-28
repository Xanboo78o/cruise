// world/races.js — every race in San Oozi, as a place. Waypoints walk the road
// network; the Route class turns them into a track. `gate` is where the start
// arch stands (and the map marker); `walls` is what the district builds them
// from; `sky` is the time the race sets when the drone brings you in.

export const RACES = [
  {
    id: 'harborLoop', name: 'HARBOR LOOP', kind: 'circuit', laps: 3, width: 24, closed: true, walls: 'concrete', sky: 0,
    blurb: 'Harbour front, up through downtown, back along the boulevard.',
    gate: [0, -1280], district: 'harbor',
    pts: [[-130, -1280], [390, -1280], [390, -780], [-390, -780], [-390, -1280]],
  },
  {
    id: 'docksCircuit', name: 'THE DOCKS', kind: 'circuit', laps: 3, width: 22, closed: true, walls: 'tyre', sky: 3,
    blurb: 'Square corners between the sheds. Handbrake country, at night.',
    gate: [1250, -1450], district: 'docks',
    pts: [[1100, -1450], [1700, -1450], [1700, -1600], [1100, -1600]],
  },
  {
    id: 'boardwalk', name: 'BOARDWALK DASH', kind: 'sprint', laps: 1, width: 22, closed: false, walls: 'tyre', sky: 0,
    blurb: 'The whole beach strip, flat out, huts on one side and sand on the other.',
    gate: [-2180, -1470], district: 'beach',
    pts: [[-2200, -1470], [-1400, -1470], [-620, -1470], [-560, -1280], [-130, -1280]],
  },
  {
    id: 'speedway', name: 'OOZI SPEEDWAY', kind: 'circuit', laps: 5, width: 34, closed: true, walls: 'concrete', sky: 1,
    blurb: 'Two sweepers, three-wide, five laps of slipstream.',
    gate: [2060, -300], district: 'speedway',
    pts: [[1900, -300], [2200, -300], [2360, -150], [2200, 0], [1900, 0], [1740, -150]],
  },
  {
    id: 'airfield', name: 'THE AIRFIELD', kind: 'circuit', laps: 3, width: 36, closed: true, walls: 'concrete', sky: 1,
    blurb: 'Runways and taxiways. A brake-point clinic.',
    gate: [2300, 700], district: 'airfield',
    pts: [[2000, 700], [2700, 700], [2750, 800], [2700, 1000], [2000, 1000], [1950, 900]],
  },
  {
    id: 'touge', name: 'TOUGE BATTLE', kind: 'touge', laps: 1, width: 16, closed: false, walls: 'rock', sky: 2,
    blurb: 'The climb to the lookout. One rival, lead then chase.',
    gate: [-1000, 400], district: 'mountain',
    pts: [[-1000, 400], [-1100, 620], [-1000, 800], [-1150, 980], [-1050, 1160], [-1250, 1300], [-1400, 1450], [-1550, 1560], [-1550, 1640]],
  },
  {
    id: 'canyon', name: 'CANYON SPRINT', kind: 'sprint', laps: 1, width: 22, closed: false, walls: 'rock', sky: 2,
    blurb: 'Down the floor of the canyon, gravel, walls up around you.',
    gate: [300, 2100], district: 'canyon',
    pts: [[300, 2100], [420, 1800], [300, 1500], [460, 1200], [340, 950], [520, 720], [640, 520], [700, 400], [600, 260]],
  },
  {
    id: 'mine', name: 'GOLD MINE', kind: 'circuit', laps: 4, width: 14, closed: true, walls: 'timber', sky: 3,
    blurb: 'A trench circuit under the hill, lit by lamps.',
    gate: [860, 780], district: 'mine',
    pts: [[860, 780], [960, 700], [1080, 640], [1120, 760], [1040, 860], [940, 880]],
  },
  {
    id: 'rimRun', name: 'RIM EXPRESS RUN', kind: 'sprint', laps: 1, width: 26, closed: false, walls: 'concrete', sky: 0,
    blurb: 'Downtown to the canyon top on the expressway. Just speed.',
    gate: [0, -520], district: 'downtown',
    pts: [[0, -520], [0, 260], [0, 600], [60, 900], [140, 1150], [180, 1400], [120, 1700], [160, 2000], [220, 2300]],
  },
  {
    id: 'forestStage', name: 'WEST FOREST STAGE', kind: 'sprint', laps: 1, width: 12, closed: false, walls: 'rock', sky: 2,
    blurb: 'Gravel through the pines. Rally, not racing.',
    gate: [-1700, -600], district: 'forest',
    pts: [[-1700, -600], [-1900, -700], [-2100, -600], [-2300, -750], [-2500, -650], [-2700, -800], [-2800, -1000], [-2700, -1200], [-2450, -1480]],
  },
  {
    id: 'coast', name: 'SEAWALL SPRINT', kind: 'sprint', laps: 1, width: 18, closed: false, walls: 'tyre', sky: 0,
    blurb: 'The cliffs to the docks along the water. Long, fast, one bad corner.',
    gate: [-2700, -1360], district: 'coast',
    pts: [[-2700, -1360], [-2450, -1480], [-1900, -1620], [-1100, -1680], [-400, -1650], [100, -1620], [700, -1660], [1400, -1700], [1800, -1690]],
  },
  {
    id: 'driftDocks', name: 'DOCKS DRIFT ZONE', kind: 'drift', laps: 1, width: 22, closed: false, walls: 'tyre', sky: 3,
    blurb: 'Two square corners, scored on angle. Hold it.',
    gate: [1700, -1450], district: 'docks',
    pts: [[1700, -1450], [1700, -1600], [1400, -1600]],
  },
];
