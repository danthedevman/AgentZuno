import {
  For,
  Show,
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
} from 'solid-js';
import {
  select,
  scaleBand,
  scaleLinear,
  scaleOrdinal,
  axisBottom,
  axisLeft,
  line,
  max,
  pie,
  arc,
} from 'd3';

export default function KnowledgeChart(props) {
  let container;
  let svg;
  const id = createUniqueId();
  const [width, setWidth] = createSignal(480);
  const values = () => props.data || [];
  const hasValues = () =>
    values().some((item) => (item.value || item.views || item.queries || 0) > 0);
  onMount(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(260, entry.contentRect.width)),
    );
    observer.observe(container);
    onCleanup(() => observer.disconnect());
  });
  createEffect(() => {
    const data = values();
    const outerWidth = width();
    if (!svg) return;
    const chart = select(svg);
    chart.selectAll('*').remove();
    const height = props.kind === 'bar' ? Math.max(180, data.length * 34 + 32) : 230;
    chart.attr('viewBox', `0 0 ${outerWidth} ${height}`);
    if (!hasValues()) return;
    if (props.kind === 'donut') {
      const colors = scaleOrdinal()
        .domain(data.map((item) => item.label))
        .range(['#92b6ed', '#b4a0df', '#91c4b1', '#d4b16e', '#8da5ba']);
      const radius = Math.min(outerWidth, height) / 2 - 15;
      const shape = arc()
        .innerRadius(radius * 0.7)
        .outerRadius(radius);
      chart
        .append('g')
        .attr('transform', `translate(${outerWidth / 2},${height / 2})`)
        .selectAll('path')
        .data(
          pie()
            .value((item) => item.value)
            .sort(null)(data),
        )
        .join('path')
        .attr('d', shape)
        .attr('fill', (item) => colors(item.data.label))
        .attr('stroke', 'var(--workspace-panel)')
        .attr('stroke-width', 3)
        .append('title')
        .text((item) => `${item.data.label}: ${item.data.value}`);
      chart
        .append('text')
        .attr('x', outerWidth / 2)
        .attr('y', height / 2 + 5)
        .attr('text-anchor', 'middle')
        .attr('class', 'chart-total')
        .text(data.reduce((sum, item) => sum + item.value, 0));
      return;
    }
    if (props.kind === 'bar') {
      const margin = { top: 10, right: 36, bottom: 18, left: Math.min(155, outerWidth * 0.38) };
      const x = scaleLinear()
        .domain([0, max(data, (item) => item.value) || 1])
        .range([margin.left, outerWidth - margin.right]);
      const y = scaleBand()
        .domain(data.map((item, index) => index))
        .range([margin.top, height - margin.bottom])
        .padding(0.35);
      chart
        .append('g')
        .selectAll('rect')
        .data(data)
        .join('rect')
        .attr('x', margin.left)
        .attr('y', (item, index) => y(index))
        .attr('width', (item) => x(item.value) - margin.left)
        .attr('height', y.bandwidth())
        .attr('rx', 3)
        .attr('class', 'chart-bar')
        .append('title')
        .text((item) => `${item.label}: ${item.value}`);
      chart
        .append('g')
        .selectAll('text')
        .data(data)
        .join('text')
        .attr('x', margin.left - 10)
        .attr('y', (item, index) => y(index) + y.bandwidth() / 2 + 4)
        .attr('text-anchor', 'end')
        .attr('class', 'chart-label')
        .text((item) => (item.label.length > 20 ? item.label.slice(0, 19) + '…' : item.label));
      chart
        .append('g')
        .selectAll('text')
        .data(data)
        .join('text')
        .attr('x', (item) => x(item.value) + 8)
        .attr('y', (item, index) => y(index) + y.bandwidth() / 2 + 4)
        .attr('class', 'chart-label')
        .text((item) => item.value);
      return;
    }
    const margin = { top: 15, right: 14, bottom: 32, left: 32 };
    const x = scaleLinear()
      .domain([0, Math.max(1, data.length - 1)])
      .range([margin.left, outerWidth - margin.right]);
    const y = scaleLinear()
      .domain([0, max(data, (item) => Math.max(item.views, item.queries)) || 1])
      .nice()
      .range([height - margin.bottom, margin.top]);
    const tickIndices = [
      ...new Set([
        0,
        Math.floor(data.length / 3),
        Math.floor((data.length * 2) / 3),
        data.length - 1,
      ]),
    ];
    chart
      .append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(
        axisBottom(x)
          .tickValues(tickIndices)
          .tickFormat((index) => data[index]?.label.slice(5) || ''),
      );
    chart
      .append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .call(
        axisLeft(y)
          .ticks(4)
          .tickFormat((value) => (Number.isInteger(value) ? value : '')),
      );
    for (const key of ['views', 'queries'])
      chart
        .append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke-width', 2)
        .attr('class', `chart-line chart-line-${key}`)
        .attr(
          'd',
          line()
            .x((item, index) => x(index))
            .y((item) => y(item[key])),
        );
  });
  return (
    <figure class="knowledge-chart" ref={container}>
      <figcaption id={`${id}-title`}>{props.title}</figcaption>
      <Show when={props.description}>
        <p class="chart-description">{props.description}</p>
      </Show>
      <Show
        when={hasValues()}
        fallback={
          <div class="chart-empty">
            {props.emptyText || 'No recorded activity for this period.'}
          </div>
        }
      >
        <svg
          ref={svg}
          role="img"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-summary`}
        />
        <span id={`${id}-summary`} class="sr-only">
          {props.kind === 'line'
            ? 'Daily article views and agent queries. Exact values are in the data table.'
            : `${values().length} categories. Exact values are in the data table.`}
        </span>
        <Show when={props.kind === 'line'}>
          <div class="chart-legend">
            <span>
              <i class="chart-legend-views" />
              Article views
            </span>
            <span>
              <i class="chart-legend-queries" />
              Agent queries
            </span>
          </div>
        </Show>
      </Show>
      <details class="chart-data">
        <summary>View data table</summary>
        <table>
          <thead>
            <tr>
              <th>{props.kind === 'line' ? 'Date (UTC)' : 'Name'}</th>
              <Show when={props.kind === 'line'} fallback={<th>Count</th>}>
                <th>Views</th>
                <th>Agent queries</th>
              </Show>
            </tr>
          </thead>
          <tbody>
            <For each={values()}>
              {(item) => (
                <tr>
                  <th scope="row">{item.label}</th>
                  <Show when={props.kind === 'line'} fallback={<td>{item.value}</td>}>
                    <td>{item.views}</td>
                    <td>{item.queries}</td>
                  </Show>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </details>
    </figure>
  );
}
