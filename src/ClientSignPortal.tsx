import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PenTool, Check, ChevronDown, ShieldCheck, RefreshCw, AlertCircle, X, Download, ChevronRight, ChevronLeft } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const APPWRITE_CONFIG = {
  endpoint: 'https://cloud.appwrite.io/v1',
  projectId: '6ab90b66003a2917b8b2',
  apiKey: 'standard_d011f6483aa840f71f9ad9fa0256f19aa4c3b4b589f9fcafe2237a639cc3cf48b365b2e456c242b2405b788867d85c4c18035a736d3523a15933cedded5d42efe4d9d2a374ced645eacfd4903b3e1eb7407e15f833a727aa64595f00031b188c8a31d919f82523230f8a45ab017f837d51276b19400b2bc7a99bdab0e9faff12',
  databaseId: '6ab90c810000f1f0489f',
  collectionId: '6ab90e27001a33441957',
  bucketId: '6ab90dfd002e7c5d9cd4'
};

function getRequestIdFromUrl(): string {
  const urlParams = new URLSearchParams(window.location.search);
  let id = urlParams.get('id');
  if (id) return id.trim();

  if (window.location.hash) {
    const hashStr = window.location.hash;
    const qIndex = hashStr.indexOf('?');
    if (qIndex !== -1) {
      const hashParams = new URLSearchParams(hashStr.substring(qIndex));
      id = hashParams.get('id');
      if (id) return id.trim();
    }
    const cleanHash = hashStr.replace('#', '').replace('/sign', '').replace('?', '').trim();
    if (cleanHash && !cleanHash.includes('=')) {
      return cleanHash;
    }
  }
  return '';
}

// Collect audit trail info about the signer's device
async function collectAuditTrail() {
  const trail: any = {
    signed_at: new Date().toISOString(),
    timestamp: Date.now(),
    user_agent: navigator.userAgent,
    platform: navigator.platform || 'unknown',
    language: navigator.language,
    screen_resolution: `${window.screen.width}x${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  try {
    const resp = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const data = await resp.json();
      trail.ip_address = data.ip;
    }
  } catch {
    trail.ip_address = 'לא זמין';
  }

  const ua = navigator.userAgent;
  if (ua.includes('Chrome') && !ua.includes('Edg')) trail.browser = 'Chrome';
  else if (ua.includes('Firefox')) trail.browser = 'Firefox';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) trail.browser = 'Safari';
  else if (ua.includes('Edg')) trail.browser = 'Edge';
  else trail.browser = 'Other';

  const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
  trail.device_type = isMobile ? 'נייד' : 'מחשב';

  return trail;
}

export default function ClientSignPortal() {
  const [searchParams] = useSearchParams();
  const requestId = getRequestIdFromUrl() || searchParams.get('id') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [docData, setDocData] = useState<any>(null);
  const [fields, setFields] = useState<any[]>([]);

  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageDimensions, setPageDimensions] = useState({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Signature Pad Modal
  const [showSigModal, setShowSigModal] = useState(false);
  const [activeField, setActiveField] = useState<any>(null);
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!requestId) {
      setError('חסר מזהה בקשת חתימה. ודא שהשתמשת בקישור המלא.');
      setLoading(false);
      return;
    }
    fetchRequestDetails();
  }, [requestId]);

  const getHeaders = () => {
    return {
      'X-Appwrite-Project': APPWRITE_CONFIG.projectId
    };
  };

  const fetchRequestDetails = async () => {
    setLoading(true);
    try {
      let doc: any = null;

      try {
        const directUrl = `${APPWRITE_CONFIG.endpoint}/databases/${APPWRITE_CONFIG.databaseId}/collections/${APPWRITE_CONFIG.collectionId}/documents/${requestId}`;
        const resp = await fetch(directUrl, {
          headers: getHeaders()
        });

        if (resp.ok) {
          doc = await resp.json();
        }
      } catch (e) {
        console.warn('Direct fetch failed, falling back to query:', e);
      }

      if (!doc) {
        try {
          const listUrl = `${APPWRITE_CONFIG.endpoint}/databases/${APPWRITE_CONFIG.databaseId}/collections/${APPWRITE_CONFIG.collectionId}/documents`;
          const resp = await fetch(listUrl, {
            headers: getHeaders()
          });

          if (resp.ok) {
            const json = await resp.json();
            if (json.documents && json.documents.length > 0) {
              doc = json.documents.find((d: any) => d.request_id === requestId || d.$id === requestId);
            }
          }
        } catch (e) {
          console.warn('List documents fallback failed:', e);
        }
      }

      if (!doc) {
        throw new Error('בקשת החתימה לא נמצאה בענן. ודא שהעלית את הבקשה מהאפליקציה.');
      }

      if (doc.status === 'signed' || doc.status === 'completed') {
        setSuccess(true);
        setLoading(false);
        return;
      }

      setDocData(doc);
      const parsedFields = JSON.parse(doc.fields_json || '[]');
      setFields(parsedFields);

      // Load PDF
      const pdfUrl = `${APPWRITE_CONFIG.endpoint}/storage/buckets/${APPWRITE_CONFIG.bucketId}/files/${doc.pdf_file_id}/view?project=${APPWRITE_CONFIG.projectId}`;
      const loadedPdf = await pdfjsLib.getDocument({
        url: pdfUrl,
        httpHeaders: getHeaders()
      }).promise;
      setPdfDoc(loadedPdf);
      setTotalPages(loadedPdf.numPages);

      setLoading(false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'אירעה שגיאה בטעינת המסמך');
      setLoading(false);
    }
  };

  useEffect(() => {
    if (pdfDoc && canvasRef.current) {
      renderPdfPage(currentPage);
    }
  }, [pdfDoc, currentPage]);

  const renderPdfPage = async (pageNum: number) => {
    if (!pdfDoc || !canvasRef.current) return;
    const page = await pdfDoc.getPage(pageNum);

    const viewport1 = page.getViewport({ scale: 1.0 });
    setPageDimensions({ width: viewport1.width, height: viewport1.height });

    const viewport = page.getViewport({ scale: 2.0 });

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport } as any).promise;
  };

  const handleFieldClick = (field: any) => {
    if (field.field_type === 'signature' || field.field_type === 'initial') {
      setActiveField(field);
      setShowSigModal(true);
    } else if (field.field_type === 'text' || field.field_type === 'date') {
      const val = prompt(field.label || 'הכנס תוכן:', field.value || '');
      if (val !== null) {
        setFields(prev => prev.map(f => f.id === field.id ? { ...f, value: val } : f));
      }
    }
  };

  const saveSignature = () => {
    if (!sigCanvasRef.current || !activeField) return;
    const dataUrl = sigCanvasRef.current.toDataURL('image/png');
    setFields(prev => prev.map(f => f.id === activeField.id ? { ...f, value: dataUrl } : f));
    setShowSigModal(false);
    setActiveField(null);
  };

  const submitFinalSignature = async () => {
    setSubmitting(true);
    try {
      const auditTrail = await collectAuditTrail();
      const rawSigners = docData?.signers_json ? JSON.parse(docData.signers_json) : [];
      const updatedSigners = rawSigners.length > 0 
        ? rawSigners.map((s: any) => ({ ...s, status: 'signed', signed_at: Date.now(), audit_trail: auditTrail }))
        : [{ name: 'חותם', status: 'signed', signed_at: Date.now(), audit_trail: auditTrail }];
      
      const patchUrl = `${APPWRITE_CONFIG.endpoint}/databases/${APPWRITE_CONFIG.databaseId}/collections/${APPWRITE_CONFIG.collectionId}/documents/${docData.$id}`;
      const resp = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          ...getHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          data: {
            status: 'signed',
            fields_json: JSON.stringify(fields),
            signers_json: JSON.stringify(updatedSigners)
          }
        })
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.message || 'נכשלה שמירת החתימה בענן');
      }

      setSuccess(true);
    } catch (err: any) {
      alert('שגיאה בשמירת החתימה: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const scrollToNextField = () => {
    const firstMissing = fields.find(f => f.field_type !== 'whiteout' && (!f.value || String(f.value).trim() === ''));
    if (!firstMissing) return;

    if (firstMissing.page_number !== currentPage) {
      setCurrentPage(firstMissing.page_number);
    }
    setTimeout(() => {
      const fieldEl = document.getElementById(`field-${firstMissing.id}`);
      if (fieldEl) {
        fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        fieldEl.classList.add('ring-4', 'ring-amber-500', 'ring-opacity-80', 'scale-[1.03]');
        setTimeout(() => fieldEl.classList.remove('ring-4', 'ring-amber-500', 'ring-opacity-80', 'scale-[1.03]'), 1200);
      }
    }, 150);
  };

  // Helper to accurately map touch/mouse coordinates to canvas internal resolution
  const getCanvasPos = (canvas: HTMLCanvasElement, e: any) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  // Signature canvas drawing handlers
  const startDrawing = (e: any) => {
    e.preventDefault();
    setIsDrawing(true);
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(canvas, e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: any) => {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(canvas, e);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSig = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const filledCount = fields.filter(f => f.field_type !== 'whiteout' && f.value && String(f.value).trim() !== '').length;
  const totalRequired = fields.filter(f => f.field_type !== 'whiteout').length;
  const isAllFilled = totalRequired > 0 && filledCount === totalRequired;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center" dir="rtl">
        <div className="w-12 h-12 border-3 border-slate-300 border-t-slate-800 rounded-full animate-spin mb-4" />
        <h2 className="text-base font-semibold text-slate-800">טוען את המסמך לחתימה</h2>
        <p className="text-slate-500 text-xs mt-1">אנא המתן מספר שניות</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center" dir="rtl">
        <div className="w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center text-xl mb-3 border border-red-200">
          <AlertCircle size={24} />
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-1">שגיאה בטעינת המסמך</h2>
        <p className="text-slate-600 text-xs mb-5 max-w-xs">{error}</p>
        <button onClick={fetchRequestDetails} className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg text-sm transition-colors">
          טען מחדש
        </button>
      </div>
    );
  }

  if (success) {
    const downloadPdfUrl = docData?.pdf_file_id 
      ? `${APPWRITE_CONFIG.endpoint}/storage/buckets/${APPWRITE_CONFIG.bucketId}/files/${docData.pdf_file_id}/view?project=${APPWRITE_CONFIG.projectId}`
      : '#';

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 text-center" dir="rtl">
        <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-xl max-w-md w-full border border-slate-200/80 flex flex-col items-center animate-in fade-in zoom-in-95 duration-200">
          {/* Big Verified Seal */}
          <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-5 border-2 border-emerald-200/80 shadow-md shadow-emerald-500/10">
            <Check size={40} className="stroke-[3]" />
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-2 tracking-tight">
            המסמך נחתם בהצלחה!
          </h2>
          <p className="text-slate-500 text-sm mb-8 leading-relaxed max-w-xs">
            החתימה נקלטה ואומתה במערכת באופן מאובטח בהתאם לחוק חתימה אלקטרונית.
          </p>

          {/* Download Button with Arrow */}
          <a
            href={downloadPdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            download={`${docData?.document_title || 'מסמך_חתום'}.pdf`}
            className="w-full h-14 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white font-bold text-base rounded-2xl shadow-lg hover:shadow-xl flex items-center justify-center gap-3 transition-all cursor-pointer mb-6"
          >
            <Download size={22} className="stroke-[2.5]" />
            <span>הורדת המסמך החתום</span>
          </a>

          {/* Security & Verification Footer */}
          <div className="w-full pt-5 border-t border-slate-100 flex items-center justify-center gap-2 text-xs text-slate-400 font-medium">
            <ShieldCheck size={16} className="text-emerald-600" />
            <span>מאומת דיגיטלית במערכת DocFlow Sign</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100/80 text-slate-900 flex flex-col justify-between selection:bg-slate-800 selection:text-white pb-24" dir="rtl">
      {/* Top Header - Minimal, Corporate, Clean */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 py-2.5 shadow-2xs">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          {/* Right: Brand */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-slate-900 text-white flex items-center justify-center">
              <PenTool size={14} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm text-slate-900 tracking-tight">DocFlow Sign</span>
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-medium border border-slate-200">
                <ShieldCheck size={11} className="text-emerald-600" />
                מאובטח
              </span>
            </div>
          </div>

          {/* Center: Document Title */}
          <div className="hidden sm:block text-xs font-medium text-slate-600 truncate max-w-xs">
            {docData?.document_title || docData?.title || 'מסמך לחתימה'}
          </div>

          {/* Left: Counter status badge */}
          <div>
            {filledCount < totalRequired ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-amber-50 text-amber-900 border border-amber-200 px-2.5 py-1 rounded-md">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span>נותרה {totalRequired - filledCount} חתימה</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-md">
                <Check size={13} className="text-emerald-600" />
                <span>כל השדות הושלמו</span>
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Centered Document Viewport */}
      <main className="w-full flex-1 flex flex-col items-center px-2 sm:px-4 py-4 sm:py-6">
        {/* Document Card (A4 Paper Elevation) */}
        <div 
          className="relative bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden w-full max-w-[850px] mx-auto my-1 transition-all"
        >
          {/* PDF Page Canvas */}
          <canvas ref={canvasRef} className="block w-full h-auto bg-white select-none pointer-events-none" />
          
          {/* Interactive Fields Overlay */}
          <div className="absolute inset-0 pointer-events-none">
            {fields.filter(f => f.page_number === currentPage).map(field => {
              const isFilled = field.value && String(field.value).trim() !== '';

              return (
                <div
                  key={field.id}
                  id={`field-${field.id}`}
                  onClick={() => handleFieldClick(field)}
                  style={{
                    position: 'absolute',
                    left: pageDimensions.width ? `${(field.x / pageDimensions.width) * 100}%` : `${field.x}px`,
                    top: pageDimensions.height ? `${(field.y / pageDimensions.height) * 100}%` : `${field.y}px`,
                    width: pageDimensions.width ? `${(field.width / pageDimensions.width) * 100}%` : `${field.width}px`,
                    height: pageDimensions.height ? `${(field.height / pageDimensions.height) * 100}%` : `${field.height}px`,
                  }}
                  className={`pointer-events-auto transition-all cursor-pointer flex items-center justify-center rounded-lg ${
                    isFilled 
                      ? 'bg-transparent border border-transparent' 
                      : 'bg-amber-100/60 border-2 border-dashed border-amber-500 hover:bg-amber-100/90 shadow-sm relative group ring-4 ring-amber-500/10'
                  }`}
                >
                  {isFilled ? (
                    <>
                      {field.value.startsWith('data:image') ? (
                        <img src={field.value} alt="חתימה" className="w-full h-full object-contain mix-blend-multiply" />
                      ) : (
                        <span className="text-slate-900 font-semibold truncate px-2 text-center" style={{ fontSize: 'clamp(12px, 1.8vw, 16px)' }} dir="auto">
                          {field.value}
                        </span>
                      )}
                      <span className="absolute top-1 left-1 w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-xs opacity-90">
                        <Check size={10} className="stroke-[3]" />
                      </span>
                    </>
                  ) : (
                    <div className="relative w-full h-full flex flex-col items-center justify-center select-none p-1 text-center">
                      <div className="absolute -top-3.5 right-1.5 flex items-center gap-1 bg-amber-500 text-slate-950 font-bold text-[10px] px-2 py-0.5 rounded shadow-xs">
                        <PenTool size={10} className="stroke-[2.5]" />
                        <span>חתימה</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-amber-950 font-bold text-xs tracking-tight">
                          {field.label || 'לחץ כאן לחתימה'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Page navigation controls */}
        {totalPages > 1 && (
          <div className="flex items-center gap-3 bg-white shadow-xs px-4 py-1.5 rounded-lg border border-slate-200 mt-3">
            <button 
              disabled={currentPage <= 1} 
              onClick={() => setCurrentPage(p => p - 1)} 
              className="p-1 text-slate-600 disabled:opacity-30 hover:text-slate-900"
            >
              <ChevronRight size={16} />
            </button>
            <span className="text-xs text-slate-600 font-medium">עמוד {currentPage} מתוך {totalPages}</span>
            <button 
              disabled={currentPage >= totalPages} 
              onClick={() => setCurrentPage(p => p + 1)} 
              className="p-1 text-slate-600 disabled:opacity-30 hover:text-slate-900"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        )}
      </main>

      {/* Fixed Bottom Action Bar - Executive Enterprise Quality */}
      <div className="fixed bottom-0 left-0 right-0 p-3 bg-white/95 backdrop-blur-md border-t border-slate-200 z-40 shadow-md">
        <div className="max-w-md mx-auto flex flex-col items-center gap-2">
          {filledCount < totalRequired ? (
            <button
              onClick={scrollToNextField}
              className="w-full h-12 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white font-semibold text-sm rounded-xl shadow-md hover:shadow-lg flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <span>מעבר לחתימה הבאה (נותרה {totalRequired - filledCount})</span>
              <ChevronDown size={16} />
            </button>
          ) : (
            <button
              onClick={submitFinalSignature}
              disabled={!isAllFilled || submitting}
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-semibold text-sm rounded-xl shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
            >
              <Check size={18} className="stroke-[2.5]" />
              <span>{submitting ? 'שומר חתימה ומאמת...' : 'סיום וחתימה על המסמך'}</span>
            </button>
          )}

          <div className="text-[10px] text-slate-400 font-normal flex items-center gap-1">
            <ShieldCheck size={12} className="text-emerald-600" />
            <span>חתימה מאובטחת לפי חוק חתימה אלקטרונית</span>
          </div>
        </div>
      </div>

      {/* Signature Pad Modal - Clean Enterprise Style */}
      {showSigModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-lg shadow-2xl flex flex-col my-auto max-h-[92vh] overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
                  <PenTool size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">חתימה דיגיטלית</h3>
                  <p className="text-[11px] text-slate-500 font-normal">חתום בתוך המסגרת בעזרת האצבע או העכבר</p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setShowSigModal(false)} 
                className="w-9 h-9 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            
            {/* Modal Body & Canvas */}
            <div className="p-4 sm:p-5 flex-1 flex flex-col">
              <div className="w-full h-48 sm:h-56 bg-slate-50/80 rounded-2xl border-2 border-slate-200 overflow-hidden relative shadow-inner">
                <canvas
                  ref={sigCanvasRef}
                  width={500}
                  height={250}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                  className="w-full h-full cursor-crosshair touch-none relative z-10"
                />
                {/* Visual signature baseline */}
                <div className="absolute bottom-6 left-6 right-6 border-b border-dashed border-slate-300 pointer-events-none flex items-center justify-between text-slate-400 select-none">
                  <span className="font-serif italic font-bold text-base">✕</span>
                  <span className="text-xs font-medium">קו חתימה</span>
                </div>
              </div>

              {/* Clear button below canvas */}
              <div className="flex justify-between items-center mt-3">
                <span className="text-xs text-slate-400 font-normal">החתימה תוטמע ישירות במסמך</span>
                <button 
                  type="button"
                  onClick={clearSig} 
                  className="px-3.5 py-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RefreshCw size={13} />
                  <span>נקה חתימה</span>
                </button>
              </div>
            </div>

            {/* Modal Footer - Large, Prominent, Clear Buttons */}
            <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/90 flex items-center gap-3">
              <button 
                type="button"
                onClick={() => setShowSigModal(false)} 
                className="flex-1 h-12 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 active:scale-[0.99] text-slate-700 font-bold text-sm transition-all cursor-pointer"
              >
                ביטול
              </button>
              <button 
                type="button"
                onClick={saveSignature} 
                className="flex-[2] h-12 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white font-bold text-sm rounded-xl shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Check size={18} className="stroke-[2.5]" />
                <span>אישור חתימה</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
