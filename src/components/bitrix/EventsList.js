export default function BitrixEventsList({ events, selectedEvents = [], onSelectionChange, onPreviewEvent }) {
  if (!events || events.length === 0) {
    return (
      <div className="card">
        <header className="card-header">
          <h2>Bitrix → Shopify Events</h2>
        </header>
        <div className="alert alert-info">
          <strong>No events yet</strong>
          <p>Webhook events from Bitrix will appear here once Bitrix starts sending them.</p>
        </div>
      </div>
    );
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      onSelectionChange(events);
    } else {
      onSelectionChange([]);
    }
  };

  const handleSelectEvent = (event, checked) => {
    const eventId = event.id || event.eventId;
    
    if (checked) {
      if (!selectedEvents.some(e => (e.id || e.eventId) === eventId)) {
        onSelectionChange([...selectedEvents, event]);
      }
    } else {
      onSelectionChange(selectedEvents.filter(e => (e.id || e.eventId) !== eventId));
    }
  };

  const isSelected = (event) => {
    const eventId = event.id || event.eventId;
    return selectedEvents.some(e => (e.id || e.eventId) === eventId);
  };

  const isAllSelected = events.length > 0 && selectedEvents.length === events.length;

  return (
    <div className="card">
      <header className="card-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Bitrix → Shopify Events ({events.length})</h2>
          {selectedEvents.length > 0 && (
            <span style={{ color: '#3b82f6', fontSize: '0.9rem' }}>
              Выбрано: {selectedEvents.length}
            </span>
          )}
        </div>
      </header>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #334155' }}>
              <th style={{ padding: '12px', textAlign: 'left', color: '#94a3b8', width: '50px' }}>
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  style={{ margin: 0 }}
                />
              </th>
              <th style={{ padding: '12px', textAlign: 'left', color: '#94a3b8' }}>Deal ID</th>
              <th style={{ padding: '12px', textAlign: 'left', color: '#94a3b8' }}>Shopify Order ID</th>
              <th style={{ padding: '12px', textAlign: 'left', color: '#94a3b8' }}>Category</th>
              <th style={{ padding: '12px', textAlign: 'left', color: '#94a3b8' }}>Stage</th>
              <th style={{ padding: '12px', textAlign: 'left', color: '#94a3b8' }}>Received At</th>
              {onPreviewEvent && (
                <th style={{ padding: '12px', textAlign: 'left', color: '#94a3b8', width: '100px' }}>Preview</th>
              )}
            </tr>
          </thead>
          <tbody>
            {events.map((event, index) => {
              const eventId = event.id || event.eventId || `event-${index}`;
              const dealId = event.dealId || 'N/A';
              const shopifyOrderId = event.shopifyOrderId || 'N/A';
              const categoryId = event.categoryId || 'N/A';
              const stageId = event.stageId || 'N/A';
              const isEventSelected = isSelected(event);
              
              return (
              <tr
                key={eventId}
                style={{
                  borderBottom: '1px solid #334155',
                  backgroundColor: isEventSelected ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                  transition: 'background-color 0.2s'
                }}
              >
                <td style={{ padding: '12px' }}>
                  <input
                    type="checkbox"
                    checked={isEventSelected}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleSelectEvent(event, e.target.checked);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    style={{ margin: 0, cursor: 'pointer' }}
                  />
                </td>
                <td style={{ padding: '12px', color: '#f1f5f9' }}>{dealId}</td>
                <td style={{ padding: '12px', color: '#f1f5f9' }}>{shopifyOrderId}</td>
                <td style={{ padding: '12px', color: '#f1f5f9' }}>{categoryId}</td>
                <td style={{ padding: '12px', color: '#f1f5f9' }}>{stageId}</td>
                <td style={{ padding: '12px', color: '#94a3b8', fontSize: '0.9rem' }}>
                  {formatDate(event.received_at || event.created_at)}
                </td>
                {onPreviewEvent && (
                  <td style={{ padding: '12px' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onPreviewEvent(event);
                      }}
                      style={{
                        padding: '4px 8px',
                        background: '#3b82f6',
                        border: 'none',
                        borderRadius: '4px',
                        color: '#f1f5f9',
                        cursor: 'pointer',
                        fontSize: '0.85rem'
                      }}
                    >
                      👁️ Preview
                    </button>
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

