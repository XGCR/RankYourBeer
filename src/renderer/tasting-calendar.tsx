import { useState } from 'react'
import type { TastingDay } from '../shared/model.ts'

const weekdays = ['周一', '', '周三', '', '周五', '', '周日']
const dateLabel = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC' })

function calendarWeeks(year: number) {
  const date = new Date(0)
  date.setUTCFullYear(year, 0, 1)
  const firstWeek: (string | null)[] = Array.from({ length: (date.getUTCDay() + 6) % 7 }, () => null)
  const days = firstWeek
  while (date.getUTCFullYear() === year) {
    days.push(date.toISOString().slice(0, 10))
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return Array.from({ length: Math.ceil(days.length / 7) }, (_, week) => days.slice(week * 7, week * 7 + 7))
}

export function TastingCalendar({ days, onOpen }: { days: TastingDay[]; onOpen: (id: string) => void }) {
  const currentYear = new Date().getFullYear()
  const [chosenYear, setChosenYear] = useState(currentYear)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const years = [...new Set([currentYear, ...days.map(day => Number(day.date.slice(0, 4)))])].sort((a, b) => b - a)
  const year = years.includes(chosenYear) ? chosenYear : currentYear
  const records = new Map(days.filter(day => Number(day.date.slice(0, 4)) === year).map(day => [day.date, day.drinks]))
  const total = [...records.values()].reduce((sum, drinks) => sum + drinks.length, 0)
  const selected = selectedDate ? records.get(selectedDate) : undefined

  return <section className="tasting-calendar" aria-labelledby="tasting-calendar-title">
    <header className="calendar-header">
      <div>
        <h2 id="tasting-calendar-title">品饮日历</h2>
        <p>记录了 {total} 款酒，分布在 {records.size} 天</p>
      </div>
      <select aria-label="日历年份" value={year} onChange={event => {
        setChosenYear(Number(event.target.value))
        setSelectedDate(null)
      }}>
        {years.map(option => <option key={option} value={option}>{option} 年</option>)}
      </select>
    </header>
    <div className="calendar-scroll" role="region" aria-label={year + ' 年每日品饮数量'} tabIndex={0}>
      <div className="calendar-grid">
        <div className="calendar-weekdays" aria-hidden="true">
          {weekdays.map((day, index) => <span key={index}>{day}</span>)}
        </div>
        {calendarWeeks(year).map((week, index) => {
          const firstOfMonth = week.find(date => date?.endsWith('-01'))
          return <div className="calendar-week" key={index}>
            <span className="calendar-month">{firstOfMonth ? Number(firstOfMonth.slice(5, 7)) + '月' : ''}</span>
            {week.map((date, slot) => {
              if (!date) return <span key={slot} aria-hidden="true" />
              const count = records.get(date)?.length ?? 0
              const label = date + ' · ' + count + ' 款'
              const level = Math.min(count, 4)
              return count ? <button type="button" key={date} className="calendar-cell"
                data-level={level} title={label} aria-label={label} aria-pressed={selectedDate === date}
                onClick={() => setSelectedDate(date)} />
                : <span key={date} className="calendar-cell" data-level={level} title={label} />
            })}
          </div>
        })}
      </div>
    </div>
    <div className="calendar-legend" aria-label="颜色对应 0 款、1 款、2 款、3 款、4 款及以上">
      <span>少</span>
      {[0, 1, 2, 3, 4].map(level => <span key={level} className="calendar-cell" data-level={level}
        title={level === 4 ? '4 款及以上' : level + ' 款'} />)}
      <span>多</span>
    </div>
    {selectedDate && selected ? <div className="calendar-detail">
      <h3>{dateLabel.format(new Date(selectedDate + 'T00:00:00Z'))} · {selected.length} 款</h3>
      <ul>
        {selected.map(drink => <li key={drink.id}>
          <button type="button" className="link-button" onClick={() => onOpen(drink.id)}>{drink.name}</button>
        </li>)}
      </ul>
    </div> : <p className="calendar-help">添加品饮日期即可在日历中显示。点击有记录的日期可查看当天的酒款。</p>}
  </section>
}
