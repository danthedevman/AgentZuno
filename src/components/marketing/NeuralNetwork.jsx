import { For } from 'solid-js';

const clusterCenters = [
  [40, 80],
  [340, 60],
  [700, 110],
  [1100, 70],
  [120, 380],
  [440, 330],
  [820, 420],
  [1200, 350],
  [10, 720],
  [340, 740],
  [720, 740],
  [1110, 710],
];
const neuronsPerCluster = 28;

const neurons = clusterCenters.flatMap(([centerX, centerY], cluster) =>
  Array.from({ length: neuronsPerCluster }, (_, index) => {
    const angle = index * 2.39996 + cluster * 0.7;
    const radius = Math.sqrt(-2 * Math.log((index + 0.5) / neuronsPerCluster)) * 55;

    return [centerX + Math.cos(angle) * radius * 1.5, centerY + Math.sin(angle) * radius * 1.05];
  }),
);

const connectionPairs = new Map();

function connectNeurons(first, second) {
  const start = Math.min(first, second);
  const end = Math.max(first, second);
  const [x, y] = neurons[start];
  const [nextX, nextY] = neurons[end];
  const curve = (start + end) % 2 === 0 ? 9 : -9;

  connectionPairs.set(`${start}:${end}`, {
    path: `M ${x} ${y} Q ${(x + nextX) / 2 + curve} ${(y + nextY) / 2 - curve} ${nextX} ${nextY}`,
    delay: `${-((start * 1.7 + end * 0.9) % 12)}s`,
  });
}

neurons.forEach(([x, y], index) => {
  neurons
    .map(([nextX, nextY], nextIndex) => ({
      index: nextIndex,
      distance: Math.hypot(nextX - x, nextY - y),
    }))
    .filter((neighbor) => neighbor.index !== index && neighbor.distance < 150)
    .sort((first, second) => first.distance - second.distance)
    .slice(0, 8)
    .forEach((neighbor) => connectNeurons(index, neighbor.index));
});

// Bridge neighboring clusters so the dense groups form one continuous web.
clusterCenters.forEach(([x, y], cluster) => {
  clusterCenters.forEach(([nextX, nextY], nextCluster) => {
    if (nextCluster <= cluster || Math.hypot(nextX - x, nextY - y) > 450) return;

    const bridges = [];

    for (let first = 0; first < neuronsPerCluster; first++) {
      for (let second = 0; second < neuronsPerCluster; second++) {
        const start = cluster * neuronsPerCluster + first;
        const end = nextCluster * neuronsPerCluster + second;
        bridges.push({
          start,
          end,
          distance: Math.hypot(
            neurons[start][0] - neurons[end][0],
            neurons[start][1] - neurons[end][1],
          ),
        });
      }
    }

    bridges.sort((first, second) => first.distance - second.distance);
    bridges.slice(0, 3).forEach(({ start, end }) => connectNeurons(start, end));
  });
});

const connections = [...connectionPairs.values()];
const connectionPath = connections.map((connection) => connection.path).join(' ');
const signals = connections.filter((_, index) => index % Math.ceil(connections.length / 12) === 0);
const pulses = clusterCenters.map(([x, y], index) => ({ x, y, delay: `${-index * 0.75}s` }));

export default function NeuralNetwork(props) {
  return (
    <div classList={{ 'neural-network': true, 'is-paused': props.paused }} aria-hidden="true">
      <svg
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        focusable="false"
      >
        <defs>
          <linearGradient
            id="neural-color"
            x1="0"
            y1="0"
            x2="1200"
            y2="800"
            gradientUnits="userSpaceOnUse"
          >
            <stop stop-color="#7ccaff" />
            <stop offset="0.5" stop-color="#65bbdf" />
            <stop offset="1" stop-color="#437daf" />
          </linearGradient>
        </defs>
        <g class="neural-connections">
          <path d={connectionPath} />
        </g>
        <For each={neurons}>
          {([x, y], index) => (
            <g class="neuron">
              <circle class="neuron-halo" cx={x} cy={y} r="7" />
              <circle class="neuron-core" cx={x} cy={y} r={index % 7 === 0 ? 2.4 : 1.3} />
            </g>
          )}
        </For>
      </svg>
      <svg
        class="neural-motion"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        focusable="false"
      >
        <g class="neural-signals">
          <For each={signals}>
            {(connection) => (
              <path
                d={connection.path}
                pathLength="100"
                style={{ 'animation-delay': connection.delay }}
              />
            )}
          </For>
        </g>
        <For each={pulses}>
          {(pulse) => (
            <circle
              class="neural-pulse"
              cx={pulse.x}
              cy={pulse.y}
              r="7"
              style={{ 'animation-delay': pulse.delay }}
            />
          )}
        </For>
      </svg>
    </div>
  );
}
