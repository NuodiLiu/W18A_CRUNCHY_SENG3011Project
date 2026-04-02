// inner join two normalized arrays by period and sort
export function mergeByPeriod(leftArr, rightArr) {
  const rightMap = new Map(rightArr.map((d) => [d.period, d.value]));

  return leftArr
    .filter((d) => rightMap.has(d.period))
    .map((d) => ({
      period: d.period,
      left: d.value,
      right: rightMap.get(d.period),
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}
