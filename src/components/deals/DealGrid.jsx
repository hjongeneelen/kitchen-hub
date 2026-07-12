import DealCard from './DealCard.jsx'
import EmptyState from './EmptyState.jsx'

export default function DealGrid({ deals, onResetFilters }) {
  if (deals.length === 0) {
    return <EmptyState onReset={onResetFilters} />
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {deals.map((deal) => (
        <DealCard key={deal.id} deal={deal} />
      ))}
    </div>
  )
}
