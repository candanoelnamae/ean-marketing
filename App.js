import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Svg, { Path } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import { supabase, supabaseConfigured } from './src/supabase';

const money = n => '₱' + Number(n || 0).toFixed(2);

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function invoicePrintHtml(invoice, lines, payment) {
  const customer = invoice?.customers || {};
  const subtotal = (lines || []).reduce((sum, line) => sum + Number(line.line_total || 0), 0);
  const discount = Number(invoice?.discount || 0);
  const total = Math.max(0, subtotal - discount);
  const signature = invoice?.customer_signature
    ? '<svg viewBox="0 0 300 100" style="width:100%;height:90px"><path d="' + htmlEscape(invoice.customer_signature) + '" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<div style="height:70px;border-bottom:1px solid #333"></div>';
  const rows = (lines || []).map(line => '<tr><td>' + htmlEscape(line.product_name) + '</td><td class="num">' + htmlEscape(line.quantity) + '</td><td class="num">' + money(line.line_total) + '</td></tr>').join('');
  const method = payment.method === 'GCASH' ? 'GCash' : 'Cash';
  const extra = payment.method === 'GCASH'
    ? '<p>GCash reference: ' + htmlEscape(payment.reference || '') + '</p><p>Sender: ' + htmlEscape(payment.senderName || '') + ' (' + htmlEscape(payment.senderNumber || '') + ')</p><p>Receiver: ' + htmlEscape(payment.receiverNumber || '') + '</p>'
    : '<p>Cash received: ' + money(payment.received) + '</p><p>Change: ' + money(Math.max(0, Number(payment.received || 0) - Number(payment.amount || 0))) + '</p>';
  return '<!doctype html><html><head><meta charset="utf-8"><title>Invoice</title><style>body{font-family:Arial,sans-serif;color:#172033;padding:28px;font-size:12px}h1{font-size:22px}.top{display:flex;justify-content:space-between;margin:22px 0}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{padding:10px 7px;border-bottom:1px solid #d9dee7;text-align:left}.num{text-align:right}.totals{margin:18px 0 18px auto;width:260px}.totals div{display:flex;justify-content:space-between;padding:5px 0}.grand{font-weight:bold;font-size:16px;border-top:1px solid #333;padding-top:9px!important}.payment{border-top:1px solid #cbd2dc;margin-top:22px;padding-top:12px}.signatures{display:flex;justify-content:space-between;gap:40px;margin-top:45px}.sig{width:45%;text-align:center}.sigline{border-top:1px solid #333;padding-top:7px;margin-top:4px}</style></head><body><h1>EAN Marketing</h1><div>INVOICE</div><div class="top"><div><b>Bill to:</b><br>' + htmlEscape(customer.name || 'Customer') + '<br>' + htmlEscape(customer.address || '') + '</div><div><b>Invoice:</b> ' + htmlEscape(invoice?.invoice_number || '') + '<br><b>Date:</b> ' + htmlEscape(invoice?.created_at ? new Date(invoice.created_at).toLocaleDateString() : '') + '<br><b>Prepared by:</b> ' + htmlEscape(payment.preparedBy || '') + '</div></div><table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead><tbody>' + rows + '</tbody></table><div class="totals"><div><span>Subtotal</span><span>' + money(subtotal) + '</span></div><div><span>Discount</span><span>- ' + money(discount) + '</span></div><div class="grand"><span>TOTAL</span><span>' + money(total) + '</span></div><div><span>Total paid</span><span>' + money(invoice?.amount_paid) + '</span></div><div><b>Balance due</b><b>' + money(invoice?.balance) + '</b></div></div><div class="payment"><b>Payment received now</b><p>Method: ' + method + '</p><p>Amount applied: ' + money(payment.amount) + '</p>' + extra + '<p>Payment date: ' + htmlEscape(new Date().toLocaleString()) + '</p></div><div class="signatures"><div class="sig">' + signature + '<div class="sigline">Customer signature</div><b>' + htmlEscape(customer.name || 'Customer') + '</b></div><div class="sig"><div style="height:90px"></div><div class="sigline">Prepared by</div><b>' + htmlEscape(payment.preparedBy || '') + '</b></div></div></body></html>';
}


export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Products');
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [invoiceModal, setInvoiceModal] = useState(false);
  const [invoiceCustomer, setInvoiceCustomer] = useState(null);
  const [invoiceCustomerSearch, setInvoiceCustomerSearch] = useState('');
  const [invoiceProductSearch, setInvoiceProductSearch] = useState('');
  const [invoiceProduct, setInvoiceProduct] = useState(null);
  const [invoiceQty, setInvoiceQty] = useState('1');
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState('0');
  const [invoicePaid, setInvoicePaid] = useState('0');
  const [invoiceDueDate, setInvoiceDueDate] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [invoiceDetail, setInvoiceDetail] = useState(null);
  const [invoiceLines, setInvoiceLines] = useState([]);
  const [invoicePayments, setInvoicePayments] = useState([]);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paymentReference, setPaymentReference] = useState('');
  const [signaturePath, setSignaturePath] = useState('');
  const [signatureDrawing, setSignatureDrawing] = useState(false);
  const [paymentScreen, setPaymentScreen] = useState(false);
  const [cashCounts, setCashCounts] = useState({1000:'0',500:'0',200:'0',100:'0',50:'0',20:'0',10:'0',5:'0',1:'0',0.25:'0'});
  const [cashReceived, setCashReceived] = useState('');
  const [gcashSenderName, setGcashSenderName] = useState('');
  const [gcashSenderNumber, setGcashSenderNumber] = useState('');
  const [gcashReceiverNumber, setGcashReceiverNumber] = useState('');
  const [gcashReference, setGcashReference] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorModal, setVendorModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);
  const [vendorForm, setVendorForm] = useState({name:'', contact_person:'', phone:'', email:'', address:'', notes:''});
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerHistory, setSelectedCustomerHistory] = useState(null);
  const [billingSearch, setBillingSearch] = useState('');
  const [customerModal, setCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [customerForm, setCustomerForm] = useState({name:'', phone:'', email:'', address:'', notes:''});
  const [search, setSearch] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({name:'', sku:'', category:'', description:'', price:'', cost:'', stock:''});
  const [expenseText, setExpenseText] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');

  const isAdmin = profile?.role === 'ADMIN';

  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return; }
    supabase.auth.getSession().then(({data}) => {
      setSession(data.session);
      if (data.session) loadProfile(data.session.user.id);
      else setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) { setProfile(null); setLoading(false); }
      else loadProfile(next.user.id);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session && profile) refresh(); }, [session, profile, tab]);

  async function loadProfile(id) {
    const {data, error} = await supabase.from('profiles').select('*').eq('id', id).single();
    if (error) Alert.alert('Profile issue', 'Your profile was not found. Ask the administrator to create your profile.');
    setProfile(data || null); setLoading(false);
  }

  async function refresh() {
    const p = await supabase.from('products').select('*').order('name');
    if (!p.error) setProducts(p.data || []);
    const s = await supabase.from('sales').select('*, products(name)').order('created_at', {ascending:false}).limit(100);
    if (!s.error) setSales(s.data || []);
    const c = await supabase.from('customers').select('*').order('name');
    if (!c.error) setCustomers(c.data || []);
    const inv = await supabase.from('invoices').select('*, customers(name,address)').order('created_at', {ascending:false}).limit(100);
    if (!inv.error) setInvoices(inv.data || []);
    if (isAdmin) {
      const v = await supabase.from('vendors').select('*').order('name');
      if (!v.error) setVendors(v.data || []);
      const e = await supabase.from('expenses').select('*').order('created_at', {ascending:false}).limit(100);
      if (!e.error) setExpenses(e.data || []);
    }
  }

  async function signIn() {
    const {data, error} = await supabase.functions.invoke('login-with-username', {
      body: { username: username.trim(), password }
    });
    if (error || !data?.session) {
      Alert.alert('Login failed', error?.message || data?.error || 'Invalid username or password.');
      return;
    }
    const {error: sessionError} = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    });
    if (sessionError) Alert.alert('Login failed', sessionError.message);
  }
  async function signOut() { await supabase.auth.signOut(); }

  function newProduct() {
    setSelected(null);
    setForm({name:'', sku:'', category:'', description:'', price:'', cost:'', stock:'0'});
    setEdit(true);
  }
  function editProduct(item) {
    setSelected(item);
    setForm({name:item.name || '', sku:item.sku || '', category:item.category || '', description:item.description || '', price:String(item.price ?? ''), cost:String(item.cost ?? ''), stock:String(item.stock ?? '0')});
    setEdit(true);
  }
  async function saveProduct() {
    if (!form.name.trim() || !form.price || !form.cost || form.stock === '') return Alert.alert('Missing information', 'Enter product name, price, cost, and stock.');
    const payload = {...form, name:form.name.trim(), price:Number(form.price), cost:Number(form.cost), stock:parseInt(form.stock,10)};
    const result = selected
      ? await supabase.from('products').update(payload).eq('id', selected.id)
      : await supabase.from('products').insert(payload);
    if (result.error) return Alert.alert('Could not save', result.error.message);
    setEdit(false); refresh();
  }
  async function choosePhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert('Permission needed', 'Allow photo access to choose a product image.');
    const result = await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'], quality:0.75});
    if (result.canceled) return;
    const asset = result.assets[0];
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    const ext = (asset.fileName || 'photo.jpg').split('.').pop();
    const path = 'products/' + Date.now() + '.' + ext;
    const {error} = await supabase.storage.from('product-images').upload(path, blob, {contentType:asset.mimeType || 'image/jpeg', upsert:true});
    if (error) return Alert.alert('Photo upload failed', error.message);
    const {data} = supabase.storage.from('product-images').getPublicUrl(path);
    setForm(old => ({...old, image_url:data.publicUrl}));
  }
  async function recordSale() {
    const qty = parseInt(quantity,10);
    if (!Number.isInteger(qty) || qty < 1) return Alert.alert('Invalid quantity', 'Enter a quantity of at least 1.');
    const {error} = await supabase.rpc('record_sale', {p_product_id:selected.id, p_quantity:qty});
    if (error) return Alert.alert('Sale not recorded', error.message);
    setSelected(null); setQuantity('1'); refresh();
    Alert.alert('Sale recorded', 'Stock has been updated.');
  }
  async function addExpense() {
    const amount = Number(expenseAmount);
    if (!expenseText.trim() || !Number.isFinite(amount) || amount <= 0) return Alert.alert('Check details', 'Enter an expense description and a valid amount.');
    const {error} = await supabase.from('expenses').insert({description:expenseText.trim(), amount, created_by:session.user.id});
    if (error) return Alert.alert('Could not save expense', error.message);
    setExpenseText(''); setExpenseAmount(''); refresh();
  }

  function newInvoice() {
    setInvoiceCustomer(null); setInvoiceProduct(null); setInvoiceQty('1');
    setInvoiceCustomerSearch(''); setInvoiceProductSearch('');
    setInvoiceItems([]); setInvoiceDiscount('0'); setInvoicePaid('0');
    setInvoiceDueDate(''); setInvoiceNotes(''); setInvoiceModal(true);
  }
  function addInvoiceItem() {
    const qty = parseInt(invoiceQty, 10);
    if (!invoiceProduct) return Alert.alert('Choose a product', 'Select a product first.');
    if (!Number.isInteger(qty) || qty < 1) return Alert.alert('Invalid quantity', 'Enter a quantity of at least 1.');
    if (qty > Number(invoiceProduct.stock || 0)) return Alert.alert('Not enough stock', 'The quantity is greater than available stock.');
    const existing = invoiceItems.find(x => x.product_id === invoiceProduct.id);
    if (existing && existing.quantity + qty > Number(invoiceProduct.stock || 0)) return Alert.alert('Not enough stock', 'The total quantity is greater than available stock.');
    setInvoiceItems(old => existing ? old.map(x => x.product_id === invoiceProduct.id ? {...x, quantity:x.quantity + qty} : x) : [...old, {product_id:invoiceProduct.id, quantity:qty, name:invoiceProduct.name, price:Number(invoiceProduct.price)}]);
    setInvoiceProduct(null); setInvoiceQty('1');
  }
  async function saveInvoice() {
    if (!invoiceCustomer) return Alert.alert('Choose a customer', 'Select a customer for this invoice.');
    if (!invoiceItems.length) return Alert.alert('Add products', 'Add at least one product to the invoice.');
    const discount = Number(invoiceDiscount || 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > invoiceSubtotal) return Alert.alert('Check discount', 'Enter a valid discount that does not exceed the subtotal.');
    const {data: invoiceId, error} = await supabase.rpc('create_invoice', {p_customer_id:invoiceCustomer.id, p_items:invoiceItems.map(x=>({product_id:x.product_id, quantity:x.quantity})), p_discount:discount, p_amount_paid:0, p_due_date:null, p_notes:invoiceNotes || null});
    if (error) return Alert.alert('Invoice not created', error.message);
    setInvoiceModal(false); setInvoiceCustomerSearch(''); setInvoiceProductSearch('');
    await refresh();
    const {data: savedInvoice, error: invoiceError} = await supabase.from('invoices').select('*, customers(name,address)').eq('id', invoiceId).single();
    if (invoiceError || !savedInvoice) return Alert.alert('Invoice saved', 'The invoice was saved, but its preview could not be opened.');
    await openInvoice(savedInvoice);
  }
  async function openInvoice(item) {
    setInvoiceDetail(item); setPaymentAmount(''); setPaymentMethod('CASH'); setPaymentReference(''); setSignaturePath(''); setPaymentScreen(false);
    const [lines, pays] = await Promise.all([
      supabase.from('invoice_items').select('*').eq('invoice_id', item.id).order('id'),
      supabase.from('payments').select('*').eq('invoice_id', item.id).order('created_at', {ascending:false})
    ]);
    if (lines.error) Alert.alert('Could not load invoice items', lines.error.message);
    if (pays.error) Alert.alert('Could not load payment history', pays.error.message);
    setInvoiceLines(lines.data || []); setInvoicePayments(pays.data || []);
  }
  async function confirmInvoice() {
    if (!invoiceDetail) return;
    if (!signaturePath.trim()) return Alert.alert('Customer signature needed', 'Ask the customer to sign in the signature box first.');
    const {error} = await supabase.from('invoices').update({customer_signature:signaturePath, confirmed_at:new Date().toISOString(), confirmed_by:session.user.id}).eq('id', invoiceDetail.id);
    if (error) return Alert.alert('Could not confirm invoice', error.message);
    const {data, error: refreshError} = await supabase.from('invoices').select('*, customers(name,address)').eq('id', invoiceDetail.id).single();
    if (refreshError) return Alert.alert('Invoice confirmed', 'The invoice was confirmed, but could not be refreshed. Close and reopen it to continue to payment.');
    if (data) setInvoiceDetail(data);
    setSignaturePath('');
    openPaymentScreen();
  }
  function openPaymentScreen() {
    setPaymentMethod('CASH'); setCashCounts({1000:'0',500:'0',200:'0',100:'0',50:'0',20:'0',10:'0',5:'0',1:'0',0.25:'0'});
    setCashReceived(''); setGcashSenderName(''); setGcashSenderNumber(''); setGcashReceiverNumber(''); setGcashReference(''); setPaymentError('');
    setPaymentScreen(true);
  }
  async function submitInvoicePayment(receivedOverride) {
    if (paymentBusy) return;
    setPaymentError('');
    const balance = Number(invoiceDetail?.balance || 0);
    const received = receivedOverride !== undefined ? Number(receivedOverride) : (paymentMethod === 'CASH' ? Number(cashReceived || 0) : Number(paymentAmount || 0));
    if (!Number.isFinite(received) || received <= 0) { setPaymentError('Enter a valid amount received.'); return; }
    if (paymentMethod === 'GCASH' && Math.round(received * 100) !== Math.round(balance * 100)) { setPaymentError('Enter the exact outstanding balance for GCash.'); return; }
    if (received < balance) { setPaymentError('Kulang ang payment. The amount received is less than the invoice balance.'); return; }
    if (paymentMethod === 'GCASH' && (!gcashSenderName.trim() || !gcashSenderNumber.trim() || !gcashReceiverNumber.trim() || !gcashReference.trim())) { setPaymentError('Complete the sender name, sender number, receiver number, and reference number.'); return; }
    setPaymentBusy(true);
    try {
      const {data: paymentId, error} = await supabase.rpc('record_invoice_payment', {p_invoice_id:invoiceDetail.id, p_amount:balance, p_payment_method:paymentMethod, p_reference_number:paymentMethod==='GCASH'?gcashReference.trim():null});
      if (error) throw error;
      const details = paymentMethod === 'CASH'
        ? {cash_denominations:cashCounts, cash_received:received, cash_change:Math.max(0,received-balance)}
        : {gcash_sender_name:gcashSenderName.trim(),gcash_sender_number:gcashSenderNumber.trim(),gcash_receiver_number:gcashReceiverNumber.trim()};
      const {error: detailError} = await supabase.from('payments').update(details).eq('id',paymentId);
      if (detailError) throw detailError;
      const {data, error: invoiceRefreshError} = await supabase.from('invoices').select('*, customers(name,address)').eq('id',invoiceDetail.id).single();
      if (invoiceRefreshError) throw invoiceRefreshError;
      const {data: freshLines, error: linesError} = await supabase.from('invoice_items').select('*').eq('invoice_id',invoiceDetail.id).order('id');
      if (linesError) throw linesError;
      await openInvoice(data);
      setPaymentScreen(false); refresh();
      Alert.alert('Payment recorded', paymentMethod==='CASH' && received>balance ? 'Payment accepted. Change: '+money(received-balance) : 'The invoice payment has been saved.');
      try {
        await Print.printAsync({html:invoicePrintHtml(data, freshLines || [], {
          method:paymentMethod, amount:balance, received, reference:gcashReference,
          senderName:gcashSenderName, senderNumber:gcashSenderNumber,
          receiverNumber:gcashReceiverNumber, preparedBy:profile?.full_name || profile?.role || ''
        })});
      } catch (printError) {
        Alert.alert('Payment saved', 'The payment was recorded, but the invoice print dialog could not open. You can try again later. ' + (printError?.message || ''));
      }
    } catch (e) { setPaymentError('Payment not recorded: '+(e.message || 'Please try again.')); }
    finally { setPaymentBusy(false); }
  }
  async function saveInvoicePayment() {
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) return Alert.alert('Invalid payment', 'Enter a payment amount greater than zero.');
    const {error} = await supabase.rpc('record_invoice_payment', {p_invoice_id:invoiceDetail.id, p_amount:amount, p_payment_method:paymentMethod, p_reference_number:paymentReference || null});
    if (error) return Alert.alert('Payment not recorded', error.message);
    setPaymentAmount(''); refresh();
    const {data} = await supabase.from('invoices').select('*, customers(name,address)').eq('id', invoiceDetail.id).single();
    if (data) await openInvoice(data);
    Alert.alert('Payment recorded', 'The invoice balance has been updated.');
  }

  function newVendor() {
    setEditingVendor(null);
    setVendorForm({name:'', contact_person:'', phone:'', email:'', address:'', notes:''});
    setVendorModal(true);
  }
  function editVendor(item) {
    setEditingVendor(item);
    setVendorForm({name:item.name || '', contact_person:item.contact_person || '', phone:item.phone || '', email:item.email || '', address:item.address || '', notes:item.notes || ''});
    setVendorModal(true);
  }
  async function saveVendor() {
    if (!vendorForm.name.trim()) return Alert.alert('Missing information', 'Enter the vendor or company name.');
    const payload = {...vendorForm, name:vendorForm.name.trim()};
    const result = editingVendor
      ? await supabase.from('vendors').update(payload).eq('id', editingVendor.id)
      : await supabase.from('vendors').insert(payload);
    if (result.error) return Alert.alert('Could not save vendor', result.error.message);
    setVendorModal(false);
    refresh();
  }
  function deleteVendor(item) {
    Alert.alert('Delete vendor?', `Delete ${item.name}?`, [
      {text:'Cancel', style:'cancel'},
      {text:'Delete', style:'destructive', onPress:async () => {
        const {error} = await supabase.from('vendors').delete().eq('id', item.id);
        if (error) Alert.alert('Could not delete vendor', error.message);
        else refresh();
      }}
    ]);
  }

  function newCustomer() {
    setEditingCustomer(null);
    setCustomerForm({name:'', phone:'', email:'', address:'', notes:''});
    setCustomerModal(true);
  }
  function editCustomer(item) {
    setEditingCustomer(item);
    setCustomerForm({name:item.name || '', phone:item.phone || '', email:item.email || '', address:item.address || '', notes:item.notes || ''});
    setCustomerModal(true);
  }
  async function saveCustomer() {
    if (!customerForm.name.trim()) return Alert.alert('Missing information', 'Enter the customer name.');
    const payload = {...customerForm, name:customerForm.name.trim()};
    const result = editingCustomer
      ? await supabase.from('customers').update(payload).eq('id', editingCustomer.id)
      : await supabase.from('customers').insert({...payload, created_by:session.user.id});
    if (result.error) return Alert.alert('Could not save customer', result.error.message);
    setCustomerModal(false);
    refresh();
  }
  function deleteCustomer(item) {
    Alert.alert('Delete customer?', `Delete ${item.name}?`, [
      {text:'Cancel', style:'cancel'},
      {text:'Delete', style:'destructive', onPress:async () => {
        const {error} = await supabase.from('customers').delete().eq('id', item.id);
        if (error) Alert.alert('Could not delete customer', error.message);
        else refresh();
      }}
    ]);
  }

  if (!supabaseConfigured) return <SafeAreaView style={styles.center}><Text style={styles.heading}>EAN Marketing</Text><Text style={styles.note}>Setup is not complete yet. Add your Supabase URL and publishable key to the app environment before running it.</Text></SafeAreaView>;
  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /><Text>Loading EAN Marketing…</Text></View>;
  if (!session) return <SafeAreaView style={styles.center}><StatusBar style="dark"/><Text style={styles.heading}>EAN Marketing</Text><Text style={styles.sub}>Sales & Inventory</Text><TextInput style={styles.input} placeholder="Username" autoCapitalize="none" value={username} onChangeText={setUsername}/><TextInput style={styles.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword}/><TouchableOpacity style={styles.primary} onPress={signIn}><Text style={styles.primaryText}>Sign in</Text></TouchableOpacity></SafeAreaView>;
  if (!profile) return <SafeAreaView style={styles.center}><Text>Profile not found. Please contact your administrator.</Text><TouchableOpacity onPress={signOut}><Text style={styles.link}>Sign out</Text></TouchableOpacity></SafeAreaView>;

  const filtered = products.filter(p => [p.name,p.sku,p.category].join(' ').toLowerCase().includes(search.toLowerCase()));
  const totalSales = sales.reduce((n,s)=>n+Number(s.total_amount||0),0);
  const totalProfit = sales.reduce((n,s)=>n+Number(s.profit||0),0);
  const totalExpenses = expenses.reduce((n,e)=>n+Number(e.amount||0),0);
  const invoiceSubtotal = invoiceItems.reduce((sum,item)=>sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  const invoiceTotal = Math.max(0, invoiceSubtotal - Number(invoiceDiscount || 0));
  const invoiceDetailSubtotal = invoiceLines.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
  const invoiceDetailDiscount = Number(invoiceDetail?.discount || 0);
  const invoiceDetailTotal = Math.max(0, invoiceDetailSubtotal - invoiceDetailDiscount);

  return <SafeAreaView style={styles.page}><StatusBar style="dark"/><View style={styles.header}><View><Text style={styles.heading}>EAN Marketing</Text><Text style={styles.sub}>{profile.full_name || profile.role}</Text></View><TouchableOpacity onPress={signOut}><Text style={styles.link}>Sign out</Text></TouchableOpacity></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.tabs}>{['Products','Sales','Customers','Billing','Reports',...(isAdmin?['Vendors','Expenses']:[])].map(t=><TouchableOpacity key={t} onPress={()=>setTab(t)} style={[styles.tab,tab===t&&styles.activeTab]}><Text style={tab===t?styles.activeTabText:styles.tabText}>{t}</Text></TouchableOpacity>)}</View></ScrollView>
    {tab==='Products' && <View style={styles.flex}><TextInput style={styles.input} placeholder="Search name, SKU, category…" value={search} onChangeText={setSearch}/>{isAdmin&&<TouchableOpacity style={styles.primary} onPress={newProduct}><Text style={styles.primaryText}>+ Add product</Text></TouchableOpacity>}<FlatList data={filtered} keyExtractor={x=>x.id} onRefresh={refresh} refreshing={false} ListEmptyComponent={<Text style={styles.note}>No products yet.</Text>} renderItem={({item})=><TouchableOpacity style={styles.product} onPress={()=>{setSelected(item);setQuantity('1')}}>{item.image_url?<Image source={{uri:item.image_url}} style={styles.thumb}/>:<View style={styles.thumbPlaceholder}><Text>Photo</Text></View>}<View style={styles.flex}><Text style={styles.productName}>{item.name}</Text><Text style={styles.note}>{item.sku || item.category || 'No SKU'} · Stock: {item.stock}</Text><Text style={styles.price}>{money(item.price)}</Text></View></TouchableOpacity>}/></View>}
    {tab==='Sales' && <FlatList data={sales} keyExtractor={x=>x.id} onRefresh={refresh} refreshing={false} ListEmptyComponent={<Text style={styles.note}>No sales recorded yet.</Text>} renderItem={({item})=><View style={styles.line}><View style={styles.flex}><Text style={styles.productName}>{item.products?.name || 'Product'}</Text><Text style={styles.note}>Qty: {item.quantity} · {new Date(item.created_at).toLocaleString()}</Text></View><Text style={styles.price}>{money(item.total_amount)}</Text></View>}/>}
    {tab==='Billing'&&<View style={styles.flex}><TextInput style={styles.input} placeholder="Search invoice number or customer…" value={billingSearch} onChangeText={setBillingSearch}/><TouchableOpacity style={styles.primary} onPress={newInvoice}><Text style={styles.primaryText}>+ Create invoice</Text></TouchableOpacity><FlatList data={invoices.filter(x=>[x.invoice_number,x.customers?.name,x.payment_status].join(' ').toLowerCase().includes(billingSearch.toLowerCase()))} keyExtractor={x=>x.id} onRefresh={refresh} refreshing={false} ListEmptyComponent={<Text style={styles.note}>No matching invoices.</Text>} renderItem={({item})=><TouchableOpacity style={styles.line} onPress={()=>openInvoice(item)}><View style={styles.flex}><Text style={styles.productName}>{item.invoice_number}</Text><Text style={styles.note}>{item.customers?.name || 'Customer'} · {new Date(item.created_at).toLocaleDateString()}</Text><Text style={styles.note}>{item.payment_status} · Balance: {money(item.balance)}</Text></View><Text style={styles.price}>{money(item.total)}</Text></TouchableOpacity>}/></View>}
    {tab==='Vendors'&&isAdmin&&<View style={styles.flex}><TextInput style={styles.input} placeholder="Search vendor or contact…" value={vendorSearch} onChangeText={setVendorSearch}/><TouchableOpacity style={styles.primary} onPress={newVendor}><Text style={styles.primaryText}>+ Add vendor</Text></TouchableOpacity><FlatList data={vendors.filter(x=>[x.name,x.contact_person,x.phone,x.email].join(' ').toLowerCase().includes(vendorSearch.toLowerCase()))} keyExtractor={x=>x.id} onRefresh={refresh} refreshing={false} ListEmptyComponent={<Text style={styles.note}>No vendors yet.</Text>} renderItem={({item})=><View style={styles.line}><View style={styles.flex}><Text style={styles.productName}>{item.name}</Text><Text style={styles.note}>{item.contact_person || 'No contact person'} {item.phone ? '· '+item.phone : ''}</Text>{item.email ? <Text style={styles.note}>{item.email}</Text> : null}{item.address ? <Text style={styles.note}>{item.address}</Text> : null}</View><View><TouchableOpacity onPress={()=>editVendor(item)}><Text style={styles.link}>Edit</Text></TouchableOpacity><TouchableOpacity onPress={()=>deleteVendor(item)}><Text style={{color:'#c62828',padding:8}}>Delete</Text></TouchableOpacity></View></View>}/></View>}
    {tab==='Customers' && <View style={styles.flex}>
      {selectedCustomerHistory ? <>
        <TouchableOpacity style={styles.secondary} onPress={()=>setSelectedCustomerHistory(null)}><Text>← Back to customers</Text></TouchableOpacity>
        <Text style={styles.heading}>{selectedCustomerHistory.name}</Text>
        <Text style={styles.note}>{selectedCustomerHistory.phone || ''} {selectedCustomerHistory.address || ''}</Text>
        <Text style={styles.label}>Transaction history · Invoices</Text>
        <FlatList
          style={styles.flex}
          data={invoices.filter(x => x.customer_id === selectedCustomerHistory.id)}
          keyExtractor={item => item.id}
          ListEmptyComponent={<Text style={styles.note}>No invoices for this customer yet.</Text>}
          renderItem={({item}) => (
            <TouchableOpacity style={styles.line} onPress={() => openInvoice(item)}>
              <View style={styles.flex}>
                <Text style={styles.productName}>{item.invoice_number}</Text>
                <Text style={styles.note}>{new Date(item.created_at).toLocaleDateString()} · {item.payment_status}</Text>
              </View>
              <Text style={styles.price}>{money(item.total)}</Text>
            </TouchableOpacity>
          )}
        />
      </> : <>
        <TextInput style={styles.input} placeholder="Search customer name, phone, email…" value={customerSearch} onChangeText={setCustomerSearch}/>
        <TouchableOpacity style={styles.primary} onPress={newCustomer}><Text style={styles.primaryText}>+ Add customer</Text></TouchableOpacity>
        <FlatList data={customers.filter(x=>[x.name,x.phone,x.email].join(' ').toLowerCase().includes(customerSearch.toLowerCase()))} keyExtractor={x=>x.id} onRefresh={refresh} refreshing={false} ListEmptyComponent={<Text style={styles.note}>No customers yet.</Text>} renderItem={({item})=><View style={styles.line}><TouchableOpacity style={styles.flex} onPress={()=>setSelectedCustomerHistory(item)}><Text style={styles.productName}>{item.name}</Text><Text style={styles.note}>{item.phone || 'No phone'} {item.email ? '· '+item.email : ''}</Text>{item.address ? <Text style={styles.note}>{item.address}</Text> : null}<Text style={styles.link}>View transaction history</Text></TouchableOpacity>{isAdmin&&<View><TouchableOpacity onPress={()=>editCustomer(item)}><Text style={styles.link}>Edit</Text></TouchableOpacity><TouchableOpacity onPress={()=>deleteCustomer(item)}><Text style={{color:'#c62828',padding:8}}>Delete</Text></TouchableOpacity></View>}</View>}/>
      </>}
    </View>}
    {tab==='Reports' && <View style={styles.report}><Text style={styles.metricLabel}>Recorded sales (latest 100)</Text><Text style={styles.metric}>{money(totalSales)}</Text><Text style={styles.metricLabel}>Gross profit</Text><Text style={styles.metric}>{money(totalProfit)}</Text>{isAdmin&&<><Text style={styles.metricLabel}>Expenses (latest 100)</Text><Text style={styles.metric}>{money(totalExpenses)}</Text><Text style={styles.metricLabel}>Profit after listed expenses</Text><Text style={styles.metric}>{money(totalProfit-totalExpenses)}</Text></>}</View>}
    {tab==='Expenses'&&isAdmin&&<View style={styles.flex}><TextInput style={styles.input} placeholder="Expense description" value={expenseText} onChangeText={setExpenseText}/><TextInput style={styles.input} placeholder="Amount (PHP)" keyboardType="decimal-pad" value={expenseAmount} onChangeText={setExpenseAmount}/><TouchableOpacity style={styles.primary} onPress={addExpense}><Text style={styles.primaryText}>Save expense</Text></TouchableOpacity><FlatList data={expenses} keyExtractor={x=>x.id} renderItem={({item})=><View style={styles.line}><Text style={styles.flex}>{item.description}</Text><Text>{money(item.amount)}</Text></View>}/></View>}
    <Modal visible={!!selected} animationType="slide" onRequestClose={()=>setSelected(null)}><SafeAreaView style={styles.modal}><ScrollView>{selected?.image_url&&<Image source={{uri:selected.image_url}} style={styles.hero}/>}<Text style={styles.heading}>{selected?.name}</Text><Text style={styles.note}>{selected?.sku} {selected?.category}</Text><Text style={styles.body}>{selected?.description}</Text><Text style={styles.price}>{money(selected?.price)} · Stock: {selected?.stock}</Text>{isAdmin&&<TouchableOpacity style={styles.secondary} onPress={()=>editProduct(selected)}><Text>Edit product</Text></TouchableOpacity>}<Text style={styles.label}>Quantity to sell</Text><TextInput style={styles.input} keyboardType="number-pad" value={quantity} onChangeText={setQuantity}/><TouchableOpacity style={styles.primary} onPress={recordSale}><Text style={styles.primaryText}>Record sale</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={()=>setSelected(null)}><Text>Close</Text></TouchableOpacity></ScrollView></SafeAreaView></Modal>
    <Modal visible={invoiceModal} animationType="slide" onRequestClose={()=>setInvoiceModal(false)}><SafeAreaView style={styles.modal}><ScrollView><Text style={styles.heading}>Create invoice</Text><Text style={styles.label}>Search customer</Text><TextInput style={styles.input} placeholder="Type customer name…" value={invoiceCustomerSearch} onChangeText={setInvoiceCustomerSearch}/>{invoiceCustomer ? <View style={[styles.line,styles.selectedLine]}><Text style={styles.flex}>Customer: {invoiceCustomer.name}</Text><TouchableOpacity onPress={()=>{setInvoiceCustomer(null);setInvoiceCustomerSearch('');}}><Text style={styles.link}>Change</Text></TouchableOpacity></View> : invoiceCustomerSearch.trim() ? customers.filter(x=>x.name.toLowerCase().includes(invoiceCustomerSearch.toLowerCase())).slice(0,8).map(x=><TouchableOpacity key={x.id} style={styles.line} onPress={()=>{setInvoiceCustomer(x);setInvoiceCustomerSearch(x.name);}}><Text style={styles.flex}>{x.name}</Text><Text style={styles.link}>Select</Text></TouchableOpacity>) : null}<Text style={styles.label}>Search product</Text><TextInput style={styles.input} placeholder="Type product name or SKU…" value={invoiceProductSearch} onChangeText={setInvoiceProductSearch}/>{invoiceProductSearch.trim() ? products.filter(x=>[x.name,x.sku].join(' ').toLowerCase().includes(invoiceProductSearch.toLowerCase())).slice(0,10).map(x=><TouchableOpacity key={x.id} style={[styles.line,invoiceProduct?.id===x.id&&styles.selectedLine]} onPress={()=>setInvoiceProduct(x)}><View style={styles.flex}><Text style={styles.productName}>{x.name}</Text><Text style={styles.note}>Stock: {x.stock} · {money(x.price)}</Text></View><Text style={styles.link}>{invoiceProduct?.id===x.id?'Selected':'Select'}</Text></TouchableOpacity>) : null}{invoiceProduct&&<View style={[styles.line,styles.selectedLine]}><Text style={styles.flex}>Selected: {invoiceProduct.name}</Text><TouchableOpacity onPress={()=>setInvoiceProduct(null)}><Text style={styles.link}>Change</Text></TouchableOpacity></View>}<TextInput style={styles.input} placeholder="Quantity" keyboardType="number-pad" value={invoiceQty} onChangeText={setInvoiceQty}/><TouchableOpacity style={styles.secondary} onPress={addInvoiceItem}><Text>Add selected product</Text></TouchableOpacity>{invoiceItems.map(x=><View key={x.product_id} style={styles.line}><Text style={styles.flex}>{x.name} × {x.quantity}</Text><Text>{money(x.price*x.quantity)}</Text><TouchableOpacity onPress={()=>setInvoiceItems(old=>old.filter(y=>y.product_id!==x.product_id))}><Text style={{color:'#c62828',paddingLeft:8}}>Remove</Text></TouchableOpacity></View>)}<View style={styles.line}><Text style={styles.flex}>Subtotal</Text><Text style={styles.price}>{money(invoiceSubtotal)}</Text></View><Text style={styles.label}>Discount (PHP)</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={invoiceDiscount} onChangeText={setInvoiceDiscount}/><View style={styles.line}><Text style={styles.flex}>OVERALL TOTAL</Text><Text style={styles.metric}>{money(invoiceTotal)}</Text></View><Text style={styles.label}>Notes</Text><TextInput style={styles.input} value={invoiceNotes} onChangeText={setInvoiceNotes} multiline/><TouchableOpacity style={styles.primary} onPress={saveInvoice}><Text style={styles.primaryText}>Save invoice</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={()=>setInvoiceModal(false)}><Text>Cancel</Text></TouchableOpacity></ScrollView></SafeAreaView></Modal>
    <Modal visible={!!invoiceDetail} animationType="slide" onRequestClose={()=>{setInvoiceDetail(null);setPaymentScreen(false);}}><SafeAreaView style={styles.modal}><ScrollView>
      {!paymentScreen ? <>
      <Text style={styles.heading}>{invoiceDetail?.invoice_number}</Text><Text style={styles.note}>{invoiceDetail?.customers?.name || 'Customer'} · {invoiceDetail?.payment_status}</Text><Text style={styles.note}>{invoiceDetail?.customers?.address || 'No customer address saved'}</Text>
      {invoiceLines.map(x=><View key={x.id} style={styles.line}><Text style={styles.flex}>{x.product_name} × {x.quantity}</Text><Text>{money(x.line_total)}</Text></View>)}
      <View style={styles.invoiceTotals}><View style={styles.invoiceTotalRow}><Text>Subtotal</Text><Text>{money(invoiceDetailSubtotal)}</Text></View><View style={styles.invoiceTotalRow}><Text>Discount</Text><Text>- {money(invoiceDetailDiscount)}</Text></View><View style={styles.invoiceTotalRow}><Text style={styles.invoiceGrandLabel}>TOTAL AMOUNT</Text><Text style={styles.invoiceGrandLabel}>{money(invoiceDetailTotal)}</Text></View></View>
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:16,marginTop:12}}>
        <View style={{flex:1}}>
          <Text style={styles.label}>Prepared by: {profile.full_name || profile.role}</Text>
          <Text style={styles.note}>Invoice date: {invoiceDetail?.created_at ? new Date(invoiceDetail.created_at).toLocaleDateString() : ''}</Text>
          {invoiceDetail?.confirmed_at ? <Text style={{color:'#16723a',fontWeight:'700',marginTop:8}}>CONFIRMED</Text> : null}
        </View>
        <View style={{width:'52%',maxWidth:300,alignItems:'stretch'}}>
          <Text style={styles.label}>Customer e-signature</Text>
          <View style={{height:105,backgroundColor:'#fff',borderWidth:1,borderColor:'#9aa4b2',borderRadius:8,marginTop:4,marginBottom:6,overflow:'hidden'}} onStartShouldSetResponder={()=>!invoiceDetail?.confirmed_at} onMoveShouldSetResponder={()=>!invoiceDetail?.confirmed_at} onResponderGrant={e=>{if(invoiceDetail?.confirmed_at)return;const {locationX:x,locationY:y}=e.nativeEvent;setSignaturePath('M '+x+' '+y);setSignatureDrawing(true);}} onResponderMove={e=>{if(!signatureDrawing||invoiceDetail?.confirmed_at)return;const {locationX:x,locationY:y}=e.nativeEvent;setSignaturePath(old=>old+' L '+x+' '+y);}} onResponderRelease={()=>setSignatureDrawing(false)}>
            <Svg width="100%" height="100%"><Path d={invoiceDetail?.customer_signature || signaturePath} stroke="#111" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></Svg>
          </View>
          <Text style={{fontWeight:'700',textAlign:'center'}}>{invoiceDetail?.customers?.name || 'Customer name'}</Text>
        </View>
      </View>
      {!invoiceDetail?.confirmed_at ? <><TouchableOpacity style={styles.secondary} onPress={()=>setSignaturePath('')}><Text>Clear signature</Text></TouchableOpacity><TouchableOpacity style={styles.primary} onPress={confirmInvoice}><Text style={styles.primaryText}>Confirmed</Text></TouchableOpacity></> : null}
      {Number(invoiceDetail?.balance)>0 && invoiceDetail?.confirmed_at ? <TouchableOpacity style={styles.primary} onPress={openPaymentScreen}><Text style={styles.primaryText}>Proceed to Payment</Text></TouchableOpacity> : null}
      <Text style={styles.metricLabel}>Paid: {money(invoiceDetail?.amount_paid)}</Text><Text style={styles.metric}>Balance: {money(invoiceDetail?.balance)}</Text>
      <Text style={styles.label}>Payment history</Text>{invoicePayments.map(x=><View key={x.id} style={styles.line}><View style={styles.flex}><Text>{money(x.amount)} · {x.payment_method}</Text><Text style={styles.note}>{new Date(x.created_at).toLocaleString()} {x.reference_number || ''}</Text></View></View>)}
      </> : <>
      <Text style={styles.heading}>Receive payment</Text><Text style={styles.productName}>{invoiceDetail?.customers?.name}</Text><Text style={styles.note}>{invoiceDetail?.customers?.address}</Text><Text style={styles.label}>Invoice balance</Text><Text style={styles.metric}>{money(invoiceDetail?.balance)}</Text>
      <View style={{flexDirection:'row',gap:10}}><TouchableOpacity style={[styles.secondary,{flex:1,borderColor:paymentMethod==='CASH'?'#2457c5':'#cbd2dc'}]} onPress={()=>setPaymentMethod('CASH')}><Text>Cash</Text></TouchableOpacity><TouchableOpacity style={[styles.secondary,{flex:1,borderColor:paymentMethod==='GCASH'?'#2457c5':'#cbd2dc'}]} onPress={()=>setPaymentMethod('GCASH')}><Text>GCash</Text></TouchableOpacity></View>
      {paymentMethod==='CASH' ? <>
        <Text style={styles.label}>Cash denominations – enter quantity of each</Text>
        {[1000,500,200,100,50,20,10,5,1,0.25].map(d=><View key={String(d)} style={styles.line}><Text style={styles.flex}>{money(d)}</Text><TextInput style={[styles.input,{width:90,marginVertical:0}]} keyboardType="number-pad" value={cashCounts[d]} onChangeText={v=>setCashCounts(old=>({...old,[d]:v}))}/><Text>{money(d*Number(cashCounts[d]||0))}</Text></View>)}
        <Text style={styles.label}>Total cash received</Text><Text style={styles.metric}>{money(Object.keys(cashCounts).reduce((sum,d)=>sum+Number(d)*Math.max(0,parseInt(cashCounts[d]||'0',10)||0),0))}</Text>
        {(()=>{const total=Object.keys(cashCounts).reduce((sum,d)=>sum+Number(d)*Math.max(0,parseInt(cashCounts[d]||'0',10)||0),0);return <Text style={{color:total<Number(invoiceDetail?.balance)?'#c62828':'#16723a',fontWeight:'800'}}>{total<Number(invoiceDetail?.balance)?'Kulang ang payment': 'OK · Change: '+money(Math.max(0,total-Number(invoiceDetail?.balance)))}</Text>;})()}
        <TouchableOpacity style={styles.primary} onPress={()=>{const total=Object.keys(cashCounts).reduce((sum,d)=>sum+Number(d)*Math.max(0,parseInt(cashCounts[d]||'0',10)||0),0);setCashReceived(String(total));submitInvoicePayment(total);}} disabled={paymentBusy}><Text style={styles.primaryText}>{paymentBusy?'Saving…':'Save cash payment'}</Text></TouchableOpacity>
      </> : <>
        {[[gcashSenderName,setGcashSenderName,'Sender full name'],[gcashSenderNumber,setGcashSenderNumber,'Sender GCash mobile number'],[gcashReceiverNumber,setGcashReceiverNumber,'Receiver GCash mobile number'],[gcashReference,setGcashReference,'GCash reference number']].map(([v,setter,placeholder])=><TextInput key={placeholder} style={styles.input} placeholder={placeholder} value={v} onChangeText={setter}/>)}
        <Text style={styles.label}>Amount paid (PHP)</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={paymentAmount} onChangeText={setPaymentAmount}/>
        {Number(paymentAmount||0)<Number(invoiceDetail?.balance)?<Text style={{color:'#c62828',fontWeight:'800'}}>Kulang ang payment</Text>:Number(paymentAmount||0)===Number(invoiceDetail?.balance)?<Text style={{color:'#16723a',fontWeight:'800'}}>OK</Text>:<Text style={{color:'#c62828'}}>Enter the exact balance for GCash.</Text>}
        {paymentError ? <Text style={{color:'#c62828',fontWeight:'700',marginVertical:8}}>{paymentError}</Text> : null}
        <TouchableOpacity style={styles.primary} onPress={()=>submitInvoicePayment()} disabled={paymentBusy}><Text style={styles.primaryText}>{paymentBusy?'Saving…':'Save GCash payment'}</Text></TouchableOpacity>
      </>}
      <TouchableOpacity style={styles.secondary} onPress={()=>setPaymentScreen(false)}><Text>Back to invoice</Text></TouchableOpacity>
      </>}
      <TouchableOpacity style={styles.secondary} onPress={()=>{setInvoiceDetail(null);setPaymentScreen(false);}}><Text>Close</Text></TouchableOpacity>
    </ScrollView></SafeAreaView></Modal>
    <Modal visible={vendorModal} animationType="slide" onRequestClose={()=>setVendorModal(false)}><SafeAreaView style={styles.modal}><ScrollView><Text style={styles.heading}>{editingVendor?'Edit vendor':'Add vendor'}</Text>{[['name','Vendor / company name'],['contact_person','Contact person'],['phone','Phone'],['email','Email'],['address','Address'],['notes','Notes']].map(([k,label])=><TextInput key={k} style={styles.input} placeholder={label} value={vendorForm[k]} onChangeText={v=>setVendorForm(old=>({...old,[k]:v}))} multiline={k==='address'||k==='notes'}/>)}<TouchableOpacity style={styles.primary} onPress={saveVendor}><Text style={styles.primaryText}>Save vendor</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={()=>setVendorModal(false)}><Text>Cancel</Text></TouchableOpacity></ScrollView></SafeAreaView></Modal>
    <Modal visible={customerModal} animationType="slide" onRequestClose={()=>setCustomerModal(false)}><SafeAreaView style={styles.modal}><ScrollView><Text style={styles.heading}>{editingCustomer?'Edit customer':'Add customer'}</Text>{[['name','Customer name'],['phone','Phone'],['email','Email'],['address','Address'],['notes','Notes']].map(([k,label])=><TextInput key={k} style={styles.input} placeholder={label} value={customerForm[k]} onChangeText={v=>setCustomerForm(old=>({...old,[k]:v}))} multiline={k==='address'||k==='notes'}/>)}<TouchableOpacity style={styles.primary} onPress={saveCustomer}><Text style={styles.primaryText}>Save customer</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={()=>setCustomerModal(false)}><Text>Cancel</Text></TouchableOpacity></ScrollView></SafeAreaView></Modal>
    <Modal visible={edit} animationType="slide" onRequestClose={()=>setEdit(false)}><SafeAreaView style={styles.modal}><ScrollView><Text style={styles.heading}>{selected?'Edit product':'Add product'}</Text>{[['name','Product name'],['sku','SKU'],['category','Category'],['description','Description'],['price','Selling price'],['cost','Cost'],['stock','Stock quantity']].map(([k,label])=><TextInput key={k} style={styles.input} placeholder={label} value={form[k]} onChangeText={v=>setForm(old=>({...old,[k]:v}))} keyboardType={['price','cost','stock'].includes(k)?'decimal-pad':'default'}/>)}<TouchableOpacity style={styles.secondary} onPress={choosePhoto}><Text>Choose product photo</Text></TouchableOpacity>{form.image_url&&<Image source={{uri:form.image_url}} style={styles.thumb}/>}<TouchableOpacity style={styles.primary} onPress={saveProduct}><Text style={styles.primaryText}>Save product</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={()=>setEdit(false)}><Text>Cancel</Text></TouchableOpacity></ScrollView></SafeAreaView></Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page:{flex:1,backgroundColor:'#f7f8fa',padding:16}, center:{flex:1,justifyContent:'center',alignItems:'center',padding:24,backgroundColor:'#f7f8fa'}, flex:{flex:1}, header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:16}, heading:{fontSize:25,fontWeight:'800',color:'#14213d'}, sub:{color:'#657080',marginTop:3}, tabs:{flexDirection:'row',marginBottom:14,borderBottomWidth:1,borderColor:'#dce1e8'}, tab:{paddingVertical:10,paddingHorizontal:12}, selectedLine:{borderWidth:1,borderColor:'#2457c5'}, activeTab:{borderBottomWidth:3,borderColor:'#2457c5'}, tabText:{color:'#687386'},activeTabText:{color:'#2457c5',fontWeight:'700'}, input:{backgroundColor:'#fff',borderWidth:1,borderColor:'#dce1e8',borderRadius:9,padding:12,marginVertical:6},primary:{backgroundColor:'#2457c5',padding:13,borderRadius:9,alignItems:'center',marginVertical:7},primaryText:{color:'#fff',fontWeight:'700'},secondary:{padding:13,borderRadius:9,borderWidth:1,borderColor:'#cbd2dc',alignItems:'center',marginVertical:7},link:{color:'#2457c5',fontWeight:'600',padding:8},note:{color:'#687386',fontSize:13,marginTop:4},product:{backgroundColor:'#fff',padding:10,marginVertical:5,borderRadius:10,flexDirection:'row',alignItems:'center',gap:12},thumb:{width:64,height:64,borderRadius:8,backgroundColor:'#e7eaf0'},thumbPlaceholder:{width:64,height:64,borderRadius:8,backgroundColor:'#e7eaf0',alignItems:'center',justifyContent:'center'},productName:{fontWeight:'700',fontSize:16,color:'#1e293b'},price:{fontWeight:'700',color:'#2457c5',marginTop:5},line:{backgroundColor:'#fff',padding:14,borderRadius:9,marginVertical:4,flexDirection:'row',alignItems:'center',gap:12},report:{backgroundColor:'#fff',padding:20,borderRadius:12},metricLabel:{color:'#687386',marginTop:12},metric:{fontSize:23,fontWeight:'800',color:'#14213d'},modal:{flex:1,padding:18,backgroundColor:'#f7f8fa'},invoiceTotals:{backgroundColor:'#fff',padding:14,borderRadius:10,marginTop:14},invoiceTotalRow:{flexDirection:'row',justifyContent:'space-between',paddingVertical:7},invoiceGrandLabel:{fontWeight:'800',fontSize:17,color:'#14213d'},signatureRow:{flexDirection:'row',gap:16,marginTop:34},signatureCell:{flex:1,alignItems:'center'},signatureLine:{height:1,backgroundColor:'#344054',alignSelf:'stretch',marginBottom:8,marginTop:20},signatureName:{fontWeight:'700',textAlign:'center',color:'#14213d'},invoiceDate:{textAlign:'center',marginTop:20,color:'#344054',fontWeight:'600'},hero:{width:'100%',height:230,borderRadius:12,marginBottom:16},label:{fontWeight:'700',marginTop:14},body:{marginVertical:12,color:'#344054'},});
