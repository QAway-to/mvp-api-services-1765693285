import Head from 'next/head';
import { useState, useEffect } from 'react';
import WebhookInfo from '../src/components/shopify/WebhookInfo';
import EventsList from '../src/components/shopify/EventsList';
import BitrixEventsList from '../src/components/bitrix/EventsList';
import DataPreview from '../src/components/shopify/DataPreview';
import { shopifyAdapter } from '../src/lib/adapters/shopify';

export default function ShopifyPage() {
  const [events, setEvents] = useState([]);
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [bitrixEvents, setBitrixEvents] = useState([]);
  const [selectedBitrixEvents, setSelectedBitrixEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBitrixLoading, setIsBitrixLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [isSendingToShopify, setIsSendingToShopify] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [sendToShopifyResult, setSendToShopifyResult] = useState(null);
  // Hardcoded Bitrix webhook base URL
  const [bitrixWebhookUrl, setBitrixWebhookUrl] = useState('https://bfcshoes.bitrix24.eu/rest/52/i6l05o71ywxb8j1l');
  const [previewEvent, setPreviewEvent] = useState(null); // Event to preview
  const [previewData, setPreviewData] = useState(null); // { shopifyData, bitrixData } for preview
  const [isInitialLoad, setIsInitialLoad] = useState(true); // Track initial load

  const fetchEvents = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/events');
      const data = await response.json();

      if (data.success) {
        const fetchedEvents = data.events || [];
        setEvents(fetchedEvents);
        setLastRefresh(new Date());
        
        // Update preview if the previewed event still exists
        if (previewEvent && previewData) {
          const updatedEvent = fetchedEvents.find(e => e.id === previewEvent.id);
          if (updatedEvent) {
            try {
              const bitrixData = shopifyAdapter.transformToBitrix(updatedEvent);
              setPreviewEvent(updatedEvent);
              setPreviewData({
                shopifyData: updatedEvent,
                bitrixData: bitrixData
              });
            } catch (error) {
              console.error('Error updating preview:', error);
            }
          }
        }
        
        // Auto-select all events only on initial load (first time only)
        if (isInitialLoad && fetchedEvents.length > 0) {
          setSelectedEvents(fetchedEvents);
          setIsInitialLoad(false);
        }
      } else {
        setError(data.error || 'Failed to fetch events');
      }
    } catch (err) {
      console.error('Fetch events error:', err);
      setError(err.message || 'Network error');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchBitrixEvents = async () => {
    setIsBitrixLoading(true);

    try {
      const response = await fetch('/api/events/bitrix');
      const data = await response.json();

      if (data.success) {
        const fetchedEvents = data.events || [];
        setBitrixEvents(fetchedEvents);
      }
    } catch (err) {
      console.error('Fetch Bitrix events error:', err);
    } finally {
      setIsBitrixLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchEvents();
    fetchBitrixEvents();

    // Auto-refresh every 5 seconds
    const interval = setInterval(() => {
      fetchEvents();
      fetchBitrixEvents();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleSendToBitrix = async () => {
    if (selectedEvents.length === 0) {
      alert('Выберите хотя бы одно событие для отправки');
      return;
    }

    if (!bitrixWebhookUrl || bitrixWebhookUrl.trim() === '') {
      alert('Пожалуйста, укажите URL вебхука Bitrix');
      return;
    }

    setIsSending(true);
    setSendResult(null);

    try {
      const response = await fetch('/api/send-to-bitrix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          selectedEvents,
          bitrixWebhookUrl: bitrixWebhookUrl.trim()
        })
      });

      const result = await response.json();

      if (response.ok || response.status === 207) {
        // 200 - все успешно, 207 - частичный успех
        setSendResult({ 
          success: result.success !== false, 
          message: result.message,
          details: result.errors && result.errors.length > 0 ? result.errors : null,
          total: result.total,
          successful: result.successful,
          failed: result.failed,
          results: result.results || [] // Store results for preview
        });
      } else {
        // 400, 500 - ошибки
        setSendResult({ 
          success: false, 
          message: result.error || 'Failed to send',
          details: result.details || (result.errors && result.errors.length > 0 ? result.errors : null),
          results: result.results || [] // Store results for preview
        });
      }
    } catch (error) {
      console.error('Send to Bitrix error:', error);
      setSendResult({ 
        success: false, 
        message: 'Network error',
        details: [{ error: error.message || 'Unknown network error' }]
      });
    } finally {
      setIsSending(false);
    }
  };

  const handlePreviewEvent = (event) => {
    try {
      const bitrixData = shopifyAdapter.transformToBitrix(event);
      setPreviewEvent(event);
      setPreviewData({
        shopifyData: event,
        bitrixData: bitrixData
      });
    } catch (error) {
      alert(`Ошибка при трансформации: ${error.message}`);
    }
  };

  const handleDownloadLogs = async () => {
    try {
      // Download logs from API endpoint
      const response = await fetch('/api/logs/download');
      
      if (!response.ok) {
        throw new Error('Failed to download logs');
      }

      // Get the text content
      const logText = await response.text();

      // Create a blob and download
      const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shopify-bitrix-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading logs:', error);
      alert(`Ошибка при скачивании логов: ${error.message}`);
    }
  };

  const handleDownloadBitrixLogs = async () => {
    try {
      // Download Bitrix logs from API endpoint
      const response = await fetch('/api/logs/download-bitrix');
      
      if (!response.ok) {
        throw new Error('Failed to download Bitrix logs');
      }

      // Get the text content
      const logText = await response.text();

      // Create a blob and download
      const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bitrix-shopify-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading Bitrix logs:', error);
      alert(`Ошибка при скачивании логов Bitrix: ${error.message}`);
    }
  };

  const handleSendToShopify = async () => {
    if (selectedBitrixEvents.length === 0) {
      alert('Выберите хотя бы одно событие для отправки');
      return;
    }

    setIsSendingToShopify(true);
    setSendToShopifyResult(null);

    try {
      const response = await fetch('/api/send-to-shopify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          selectedEvents: selectedBitrixEvents
        })
      });

      const result = await response.json();

      if (response.ok || response.status === 207) {
        // 200 - все успешно, 207 - частичный успех
        setSendToShopifyResult({ 
          success: result.success !== false, 
          message: result.message,
          details: result.errors && result.errors.length > 0 ? result.errors : null,
          total: result.total,
          successful: result.successful,
          failed: result.failed,
          results: result.results || []
        });
      } else {
        // 400, 500 - ошибки
        setSendToShopifyResult({ 
          success: false, 
          message: result.error || 'Failed to send',
          details: result.details || (result.errors && result.errors.length > 0 ? result.errors : null),
          results: result.results || []
        });
      }
    } catch (error) {
      console.error('Send to Shopify error:', error);
      setSendToShopifyResult({ 
        success: false, 
        message: 'Network error',
        details: [{ error: error.message || 'Unknown network error' }]
      });
    } finally {
      setIsSendingToShopify(false);
    }
  };

  const handlePreviewFromResult = (resultItem) => {
    if (resultItem.shopifyData && resultItem.bitrixData) {
      setPreviewEvent(resultItem.shopifyData);
      setPreviewData({
        shopifyData: resultItem.shopifyData,
        bitrixData: resultItem.bitrixData
      });
    }
  };

  const handleSelectAll = () => {
    if (events.length > 0) {
      setSelectedEvents(events);
    }
  };

  const handleDeselectAll = () => {
    setSelectedEvents([]);
  };

  const handleSendPreviewEvent = async () => {
    if (!previewEvent) {
      alert('Нет события для отправки');
      return;
    }

    if (!bitrixWebhookUrl || bitrixWebhookUrl.trim() === '') {
      alert('Пожалуйста, укажите URL вебхука Bitrix');
      return;
    }

    setIsSending(true);
    setSendResult(null);

    try {
      const response = await fetch('/api/send-to-bitrix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          selectedEvents: [previewEvent],
          bitrixWebhookUrl: bitrixWebhookUrl.trim()
        })
      });

      const result = await response.json();

      if (response.ok || response.status === 207) {
        setSendResult({ 
          success: result.success !== false, 
          message: result.message,
          details: result.errors && result.errors.length > 0 ? result.errors : null,
          total: result.total,
          successful: result.successful,
          failed: result.failed,
          results: result.results || []
        });
      } else {
        setSendResult({ 
          success: false, 
          message: result.error || 'Failed to send',
          details: result.details || (result.errors && result.errors.length > 0 ? result.errors : null),
          results: result.results || []
        });
      }
    } catch (error) {
      console.error('Send to Bitrix error:', error);
      setSendResult({ 
        success: false, 
        message: 'Network error',
        details: [{ error: error.message || 'Unknown network error' }]
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <Head>
        <title>Shopify Webhook - API Services</title>
        <meta name="description" content="Monitor Shopify webhook events" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      <main className="page">
        <header className="page-header">
          <div>
            <h1>Webhook Monitor</h1>
            <p className="subtitle">
              Monitor Shopify → Bitrix and Bitrix → Shopify webhook events in real-time
            </p>
          </div>
          <div className="header-actions">
            {events.length > 0 && (
              <>
                {selectedEvents.length === events.length ? (
                  <button
                    onClick={handleDeselectAll}
                    className="btn"
                    style={{
                      marginRight: '12px',
                      background: '#6b7280',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      color: 'white',
                      cursor: 'pointer'
                    }}
                  >
                    Снять выбор
                  </button>
                ) : (
                  <button
                    onClick={handleSelectAll}
                    className="btn"
                    style={{
                      marginRight: '12px',
                      background: '#3b82f6',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      color: 'white',
                      cursor: 'pointer'
                    }}
                  >
                    ✓ Выбрать все ({events.length})
                  </button>
                )}
              </>
            )}
            <button
              onClick={handleSendToBitrix}
              className="btn"
              disabled={isSending || selectedEvents.length === 0}
              style={{
                marginRight: '12px',
                background: selectedEvents.length > 0 ? '#059669' : '#6b7280',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                color: 'white',
                cursor: selectedEvents.length > 0 ? 'pointer' : 'not-allowed'
              }}
            >
              {isSending ? 'Отправка...' : `📤 Отправить в Bitrix (${selectedEvents.length})`}
            </button>
            <button
              onClick={handleDownloadLogs}
              className="btn"
              style={{
                marginRight: '12px',
                background: '#7c3aed',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                color: 'white',
                cursor: 'pointer'
              }}
              title="Download Shopify logs as .txt file"
            >
              📥 Скачать логи (Shopify)
            </button>
            {bitrixEvents.length > 0 && (
              <>
                {selectedBitrixEvents.length === bitrixEvents.length ? (
                  <button
                    onClick={() => setSelectedBitrixEvents([])}
                    className="btn"
                    style={{
                      marginRight: '12px',
                      background: '#6b7280',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      color: 'white',
                      cursor: 'pointer'
                    }}
                  >
                    Снять выбор (Bitrix)
                  </button>
                ) : (
                  <button
                    onClick={() => setSelectedBitrixEvents(bitrixEvents)}
                    className="btn"
                    style={{
                      marginRight: '12px',
                      background: '#3b82f6',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      color: 'white',
                      cursor: 'pointer'
                    }}
                  >
                    ✓ Выбрать все Bitrix ({bitrixEvents.length})
                  </button>
                )}
              </>
            )}
            <button
              onClick={handleSendToShopify}
              className="btn"
              disabled={isSendingToShopify || selectedBitrixEvents.length === 0}
              style={{
                marginRight: '12px',
                background: selectedBitrixEvents.length > 0 ? '#059669' : '#6b7280',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                color: 'white',
                cursor: selectedBitrixEvents.length > 0 ? 'pointer' : 'not-allowed'
              }}
            >
              {isSendingToShopify ? 'Отправка...' : `📤 Отправить в Shopify (${selectedBitrixEvents.length})`}
            </button>
            <button
              onClick={handleDownloadBitrixLogs}
              className="btn"
              style={{
                marginRight: '12px',
                background: '#7c3aed',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                color: 'white',
                cursor: 'pointer'
              }}
              title="Download Bitrix logs as .txt file"
            >
              📥 Скачать логи (Bitrix)
            </button>
            <button
              onClick={fetchEvents}
              className="btn"
              disabled={isLoading}
            >
              {isLoading ? 'Refreshing...' : '🔄 Refresh'}
            </button>
          </div>
        </header>

        {sendResult && (
          <div style={{
            padding: '16px',
            borderRadius: '8px',
            marginBottom: '20px',
            background: sendResult.success ? 'rgba(5, 150, 105, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${sendResult.success ? '#059669' : '#ef4444'}`,
            color: sendResult.success ? '#059669' : '#ef4444'
          }}>
            <div style={{ fontWeight: 600, marginBottom: '8px' }}>
              {sendResult.message}
            </div>
            {sendResult.total !== undefined && (
              <div style={{ fontSize: '0.9rem', marginTop: '8px', opacity: 0.9 }}>
                Всего: {sendResult.total} | Успешно: {sendResult.successful || 0} | Ошибок: {sendResult.failed || 0}
              </div>
            )}
            {sendResult.details && sendResult.details.length > 0 && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${sendResult.success ? 'rgba(5, 150, 105, 0.3)' : 'rgba(239, 68, 68, 0.3)'}` }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '8px' }}>Детали ошибок:</div>
                {sendResult.details.map((err, idx) => (
                  <div key={idx} style={{ 
                    fontSize: '0.8rem', 
                    marginBottom: '6px',
                    padding: '6px 8px',
                    background: 'rgba(0, 0, 0, 0.2)',
                    borderRadius: '4px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div>
                      {err.eventId && <strong>Event ID {err.eventId}: </strong>}
                      {err.error || err.message || 'Unknown error'}
                      {err.details && <div style={{ marginTop: '4px', opacity: 0.8 }}>{err.details}</div>}
                      {err.status && <div style={{ marginTop: '4px', opacity: 0.8 }}>HTTP {err.status}: {err.statusText || ''}</div>}
                    </div>
                    {(err.shopifyData && err.bitrixData) && (
                      <button
                        onClick={() => handlePreviewFromResult(err)}
                        style={{
                          padding: '4px 8px',
                          background: '#3b82f6',
                          border: 'none',
                          borderRadius: '4px',
                          color: '#f1f5f9',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          marginLeft: '8px'
                        }}
                      >
                        👁️ Preview
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {sendResult.results && sendResult.results.length > 0 && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${sendResult.success ? 'rgba(5, 150, 105, 0.3)' : 'rgba(239, 68, 68, 0.3)'}` }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '8px' }}>Результаты отправки:</div>
                {sendResult.results.map((result, idx) => (
                  <div key={idx} style={{ 
                    fontSize: '0.8rem', 
                    marginBottom: '6px',
                    padding: '6px 8px',
                    background: result.success ? 'rgba(5, 150, 105, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '4px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div>
                      {result.eventId && <strong>Event ID {result.eventId}: </strong>}
                      {result.success ? '✓ Успешно отправлено' : (result.error || 'Ошибка отправки')}
                      {result.status && <div style={{ marginTop: '4px', opacity: 0.8 }}>HTTP {result.status}</div>}
                    </div>
                    {(result.shopifyData && result.bitrixData) && (
                      <button
                        onClick={() => handlePreviewFromResult(result)}
                        style={{
                          padding: '4px 8px',
                          background: '#3b82f6',
                          border: 'none',
                          borderRadius: '4px',
                          color: '#f1f5f9',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          marginLeft: '8px'
                        }}
                      >
                        👁️ Preview
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {lastRefresh && (
          <div style={{
            padding: '8px 16px',
            background: 'rgba(59, 130, 246, 0.1)',
            borderRadius: '8px',
            marginBottom: '20px',
            fontSize: '0.9rem',
            color: '#94a3b8'
          }}>
            Last refreshed: {lastRefresh.toLocaleTimeString()} (Auto-refresh every 5s)
          </div>
        )}

        {error && (
          <div className="alert alert-error">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Webhook Configuration */}
        <WebhookInfo onBitrixUrlChange={setBitrixWebhookUrl} />

        {/* Events Lists - Two columns: Shopify → Bitrix and Bitrix → Shopify */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '20px',
          marginTop: '20px'
        }}>
          {/* Left column: Shopify → Bitrix */}
          <div>
            <h2 style={{ color: '#f1f5f9', marginBottom: '16px', fontSize: '1.5rem' }}>
              Shopify → Middleware → Bitrix
            </h2>
          <EventsList
            events={events}
            selectedEvents={selectedEvents}
            onSelectionChange={setSelectedEvents}
            onPreviewEvent={handlePreviewEvent}
          />
            <div className="card" style={{ marginTop: '20px' }}>
            <header className="card-header">
              <h2>Selected Events Summary</h2>
            </header>
            <div style={{ padding: '20px' }}>
              {selectedEvents.length === 0 ? (
                <p style={{ color: '#94a3b8' }}>No events selected</p>
              ) : (
                <div>
                  <p style={{ color: '#f1f5f9', marginBottom: '12px' }}>
                    <strong>{selectedEvents.length}</strong> event(s) selected for sending to Bitrix
                  </p>
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {selectedEvents.map((event, index) => (
                      <div key={event.id || index} style={{
                        padding: '8px 12px',
                        marginBottom: '8px',
                        background: 'rgba(59, 130, 246, 0.1)',
                        borderRadius: '6px',
                        border: '1px solid #3b82f6'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#f1f5f9', fontWeight: 600 }}>
                            Order #{event.id}
                          </span>
                          <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                            {event.total_price} {event.currency}
                          </span>
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '4px' }}>
                          {event.email}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>

          {/* Right column: Bitrix → Shopify */}
          <div>
            <h2 style={{ color: '#f1f5f9', marginBottom: '16px', fontSize: '1.5rem' }}>
              Bitrix → Middleware → Shopify
            </h2>
            {sendToShopifyResult && (
              <div style={{
                padding: '16px',
                borderRadius: '8px',
                marginBottom: '20px',
                background: sendToShopifyResult.success ? 'rgba(5, 150, 105, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${sendToShopifyResult.success ? '#059669' : '#ef4444'}`,
                color: sendToShopifyResult.success ? '#059669' : '#ef4444'
              }}>
                <div style={{ fontWeight: 600, marginBottom: '8px' }}>
                  {sendToShopifyResult.message}
                </div>
                {sendToShopifyResult.total !== undefined && (
                  <div style={{ fontSize: '0.9rem', marginTop: '8px', opacity: 0.9 }}>
                    Всего: {sendToShopifyResult.total} | Успешно: {sendToShopifyResult.successful || 0} | Ошибок: {sendToShopifyResult.failed || 0}
                  </div>
                )}
                {sendToShopifyResult.details && sendToShopifyResult.details.length > 0 && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${sendToShopifyResult.success ? 'rgba(5, 150, 105, 0.3)' : 'rgba(239, 68, 68, 0.3)'}` }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '8px' }}>Детали ошибок:</div>
                    {sendToShopifyResult.details.map((err, idx) => (
                      <div key={idx} style={{ 
                        fontSize: '0.8rem', 
                        marginBottom: '6px',
                        padding: '6px 8px',
                        background: 'rgba(0, 0, 0, 0.2)',
                        borderRadius: '4px'
                      }}>
                        {err.eventId && <strong>Event ID {err.eventId}: </strong>}
                        {err.error || err.message || 'Unknown error'}
                        {err.details && <div style={{ marginTop: '4px', opacity: 0.8 }}>{err.details}</div>}
                        {err.status && <div style={{ marginTop: '4px', opacity: 0.8 }}>HTTP {err.status}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <BitrixEventsList
              events={bitrixEvents}
              selectedEvents={selectedBitrixEvents}
              onSelectionChange={setSelectedBitrixEvents}
            />
            <div className="card" style={{ marginTop: '20px' }}>
              <header className="card-header">
                <h2>Selected Events Summary</h2>
              </header>
              <div style={{ padding: '20px' }}>
                {selectedBitrixEvents.length === 0 ? (
                  <p style={{ color: '#94a3b8' }}>No events selected</p>
                ) : (
                  <div>
                    <p style={{ color: '#f1f5f9', marginBottom: '12px' }}>
                      <strong>{selectedBitrixEvents.length}</strong> event(s) selected
                    </p>
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                      {selectedBitrixEvents.map((event, index) => (
                        <div key={event.id || index} style={{
                          padding: '8px 12px',
                          marginBottom: '8px',
                          background: 'rgba(59, 130, 246, 0.1)',
                          borderRadius: '6px',
                          border: '1px solid #3b82f6'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#f1f5f9', fontWeight: 600 }}>
                              Deal #{event.dealId}
                            </span>
                            <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                              {event.stageId}
                            </span>
                          </div>
                          <div style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '4px' }}>
                            Shopify Order: {event.shopifyOrderId || 'N/A'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Data Preview */}
        {previewData && previewEvent && (
          <DataPreview
            shopifyData={previewData.shopifyData}
            bitrixData={previewData.bitrixData}
            eventId={previewEvent.id}
            onSendEvent={handleSendPreviewEvent}
            isSending={isSending}
          />
        )}
      </main>
    </>
  );
}
