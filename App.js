import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Alert, FlatList, Image, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Svg, { Path } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import { supabase, supabaseConfigured } from './src/supabase';
import { saveCachedRecords, readCachedRecords, addPendingOperation, getPendingOperations, removePendingOperation, recordOperationFailure, getNetworkStatus, subscribeToNetworkChanges } from './src/offlineStore';

const money = n => '₱' + Number(n || 0).toFixed(2);
const makeLocalId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0;
  return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});
const sameRecordVersion = (remote, base) => Boolean(remote && base && Object.keys(base).every(key => JSON.stringify(remote[key] ?? null) === JSON.stringify(base[key] ?? null)));

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
  const [isOnline, setIsOnline] = useState(true);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncBusy, setSyncBusy] = useState(false);
  const [tab, setTab] = useState('Home');
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
  const [bookings, setBookings] = useState([]);
  const [bookingModal, setBookingModal] = useState(false);
  const [bookingCustomer, setBookingCustomer] = useState(null);
  const [bookingCustomerSearch, setBookingCustomerSearch] = useState('');
  const [bookingProductSearch, setBookingProductSearch] = useState('');
  const [bookingProduct, setBookingProduct] = useState(null);
  const [bookingQty, setBookingQty] = useState('1');
  const [bookingItems, setBookingItems] = useState([]);
  const [bookingNotes, setBookingNotes] = useState('');
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookingDetail, setBookingDetail] = useState(null);
  const [bookingDetailItems, setBookingDetailItems] = useState([]);


  const isAdmin = profile?.role === 'ADMIN';
  const canAddProducts = Boolean(profile);

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
  useEffect(() => {
    if (!session || !profile) return;
    updatePendingCount();
    if (isOnline) syncPendingOperations();
  }, [session, profile, isOnline]);

  useEffect(() => {
    getNetworkStatus().then(setIsOnline).catch(() => setIsOnline(false));
    const subscription = subscribeToNetworkChanges(online => {
      setIsOnline(online);
      if (online && session && profile) {
        refresh();
        syncPendingOperations();
      }
    });
    return () => subscription.remove();
  }, [session, profile]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async state => {
      if (state === 'active') {
        const online = await getNetworkStatus().catch(() => false);
        setIsOnline(online);
        if (online && session && profile) syncPendingOperations();
      }
    });
    return () => subscription.remove();
  }, [session, profile, isOnline]);

  // Keep every signed-in screen in sync with changes made by other users.
  useEffect(() => {
    if (!session || !profile) return;
    const channel = supabase.channel('ean-marketing-live')
      .on('postgres_changes', {event:'*', schema:'public', table:'products'}, refresh)
      .on('postgres_changes', {event:'*', schema:'public', table:'sales'}, refresh)
      .on('postgres_changes', {event:'*', schema:'public', table:'customers'}, refresh)
      .on('postgres_changes', {event:'*', schema:'public', table:'invoices'}, refresh)
      .on('postgres_changes', {event:'*', schema:'public', table:'invoice_items'}, refresh)
      .on('postgres_changes', {event:'*', schema:'public', table:'payments'}, refresh)
      .on('postgres_changes', {event:'*', schema:'public', table:'vendors'}, refresh)
      .on('postgres_changes', {event:'*', schema:'public', table:'expenses'}, refresh)
      .on('postgres_changes', {event:'*', schema:'public', table:'bookings'}, refresh)
      .on('postgres_changes', {event:'*', schema:'public', table:'booking_items'}, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session, profile, isAdmin]);

  async function updatePendingCount() {
    if (!session?.user?.id) return;
    const queued = await getPendingOperations(session.user.id);
    setPendingSyncCount(queued.length);
  }

  async function syncPendingOperations() {
    if (!session?.user?.id || !isOnline || syncBusy) return;
    setSyncBusy(true);
    try {
      const queued = await getPendingOperations(session.user.id);
      for (const operation of queued) {
        try {
          if (operation.operation_type === 'rpc' && operation.table_name === 'create_booking') {
            const {error} = await supabase.rpc('create_booking', operation.payload.rpcPayload);
            if (error) throw error;
            await removePendingOperation(operation.id);
            continue;
          }
          if (operation.operation_type === 'rpc' && operation.table_name === 'record_sale') {
            const {error} = await supabase.rpc('record_sale_idempotent', operation.payload.rpcPayload);
            if (error) throw error;
            await removePendingOperation(operation.id);
            continue;
          }
          const {data: remote, error: readError} = await supabase.from(operation.table_name).select('*').eq('id', operation.record_id).maybeSingle();
          if (readError) throw readError;
          if (operation.operation_type === 'upsert') {
            const base = operation.payload.baseRecord;
            if (base && (!remote || !sameRecordVersion(remote, base))) {
              throw new Error('Sync conflict: this record changed on the server after your offline edit. The pending change was kept on this device and was not uploaded.');
            }
            const {error} = await supabase.from(operation.table_name).upsert(operation.payload.record, {onConflict:'id'});
            if (error) throw error;
          } else if (operation.operation_type === 'delete') {
            if (remote && !sameRecordVersion(remote, operation.payload.baseRecord)) {
              throw new Error('Sync conflict: this record changed on the server after your offline delete. The pending change was kept on this device.');
            }
            if (remote) {
              const {error} = await supabase.from(operation.table_name).delete().eq('id', operation.record_id);
              if (error) throw error;
            }
          }
          await removePendingOperation(operation.id);
        } catch (error) {
          await recordOperationFailure(operation.id, error?.message || 'Sync failed');
        }
      }
      await updatePendingCount();
      await refresh();
    } finally {
      setSyncBusy(false);
    }
  }

  async function loadProfile(id) {
    const {data, error} = await supabase.from('profiles').select('*').eq('id', id).single();
    if (!error && data) {
      setProfile(data);
      await saveCachedRecords(id, 'profile', data);
    } else {
      const cached = await readCachedRecords(id, 'profile');
      if (cached) setProfile(cached);
      else Alert.alert('Profile issue', 'Your profile is not available on this device. Connect to the internet and sign in again.');
    }
    setLoading(false);
  }

  async function refresh() {
    if (!session?.user?.id) return;
    const userId = session.user.id;
    async function loadList(query, cacheKey, setter) {
      try {
        const result = await query;
        if (!result.error) {
          let rows = result.data || [];
          const queued = await getPendingOperations(userId);
          for (const operation of queued) {
            if (operation.operation_type === 'rpc' && operation.table_name === 'create_booking' && cacheKey === 'bookings') {
              const localBooking = operation.payload.localBooking;
              if (localBooking && !rows.some(item => item.id === localBooking.id)) rows = [localBooking, ...rows];
              continue;
            }
            if (operation.operation_type === 'rpc' && operation.table_name === 'record_sale' && cacheKey === 'sales') {
              const localSale = operation.payload.localRecord;
              if (localSale && !rows.some(item => item.id === localSale.id)) rows = [localSale, ...rows];
              continue;
            }
            if (operation.table_name !== cacheKey) continue;
            if (operation.operation_type === 'upsert') {
              const record = operation.payload.record;
              rows = rows.some(item => item.id === operation.record_id)
                ? rows.map(item => item.id === operation.record_id ? record : item)
                : [...rows, record];
            } else if (operation.operation_type === 'delete') {
              rows = rows.filter(item => item.id !== operation.record_id);
            }
          }
          setter(rows);
          await saveCachedRecords(userId, cacheKey, rows);
          return;
        }
      } catch (error) {}
      const cached = await readCachedRecords(userId, cacheKey);
      if (cached !== null) setter(cached);
    }
    await Promise.all([
      loadList(supabase.from('products').select('*').order('name'), 'products', setProducts),
      loadList(supabase.from('sales').select('*, products(name)').order('created_at', {ascending:false}).limit(100), 'sales', setSales),
      loadList(supabase.from('customers').select('*').order('name'), 'customers', setCustomers),
      loadList(supabase.from('invoices').select('*, customers(name,address)').order('created_at', {ascending:false}).limit(100), 'invoices', setInvoices),
      loadList(supabase.from('bookings').select('*, customers(name)').order('created_at', {ascending:false}).limit(200), 'bookings', setBookings)
    ]);
    if (isAdmin) {
      await Promise.all([
        loadList(supabase.from('vendors').select('*').order('name'), 'vendors', setVendors),
        loadList(supabase.from('expenses').select('*').order('created_at', {ascending:false}).limit(100), 'expenses', setExpenses)
      ]);
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
    if (selected && !isAdmin) return Alert.alert('Not allowed', 'You can add new products, but only an administrator can edit existing products.');
    if (!canAddProducts) return Alert.alert('Not allowed', 'You must be signed in to add products.');
    if (!form.name.trim() || !form.price || !form.cost || form.stock === '') return Alert.alert('Missing information', 'Enter product name, price, cost, and stock.');
    const payload = {...form, name:form.name.trim(), price:Number(form.price), cost:Number(form.cost), stock:parseInt(form.stock,10)};
    const online = await getNetworkStatus();
    if (!online) {
      const record = selected ? {...selected, ...payload} : {...payload, id:makeLocalId()};
      await addPendingOperation(session.user.id, {
        type:'upsert', table:'products', recordId:record.id,
        payload:{record, baseRecord:selected || null}
      });
      const next = selected ? products.map(x=>x.id===selected.id?record:x) : [...products,record];
      setProducts(next);
      await saveCachedRecords(session.user.id, 'products', next);
      await updatePendingCount();
      setEdit(false);
      Alert.alert('Saved on this device', 'This product change is queued and will sync when internet returns.');
      return;
    }
    const result = selected
      ? await supabase.from('products').update(payload).eq('id', selected.id)
      : await supabase.from('products').insert(payload);
    if (result.error) return Alert.alert('Could not save', result.error.message);
    setEdit(false); refresh();
  }
  function deleteProduct(item) {
    if (!isAdmin) return Alert.alert('Not allowed', 'Only an administrator can delete products.');
    Alert.alert('Delete product?', 'Delete "' + item.name + '"? If it is already used in a sale or invoice, the database may prevent deletion to protect transaction history.', [
      {text:'Cancel', style:'cancel'},
      {text:'Delete', style:'destructive', onPress:async () => {
        const online = await getNetworkStatus();
        if (!online) {
          await addPendingOperation(session.user.id, {type:'delete', table:'products', recordId:item.id, payload:{baseRecord:item}});
          const next = products.filter(x=>x.id!==item.id);
          setProducts(next); await saveCachedRecords(session.user.id, 'products', next);
          await updatePendingCount(); setSelected(null);
          Alert.alert('Delete queued', 'The product is removed from this device and will sync when internet returns.');
          return;
        }
        const {error} = await supabase.from('products').delete().eq('id', item.id);
        if (error) Alert.alert('Could not delete product', error.message);
        else { setSelected(null); refresh(); Alert.alert('Product deleted', 'The product has been deleted.'); }
      }}
    ]);
  }
  async function choosePhoto() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow photo access to choose a product image.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.75,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error('Could not read the selected photo from this device.');
      const fileData = await response.arrayBuffer();
      if (!fileData || fileData.byteLength === 0) throw new Error('The selected photo is empty or could not be read.');

      const contentType = asset.mimeType || 'image/jpeg';
      const extension = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const path = 'products/' + Date.now() + '.' + extension;
      const { error } = await supabase.storage
        .from('product-images')
        .upload(path, fileData, { contentType, upsert: true });

      if (error) throw error;

      const { data } = supabase.storage.from('product-images').getPublicUrl(path);
      setForm(old => ({ ...old, image_url: data.publicUrl }));
      Alert.alert('Photo uploaded', 'Your product photo is ready. Save the product to keep it.');
    } catch (error) {
      Alert.alert('Photo upload failed', error?.message || 'Please try choosing the photo again.');
    }
  }
  async function recordSale() {
    const qty = parseInt(quantity,10);
    if (!Number.isInteger(qty) || qty < 1) return Alert.alert('Invalid quantity', 'Enter a quantity of at least 1.');
    if (!selected) return Alert.alert('Choose a product', 'Select a product before recording a sale.');
    const requestId = makeLocalId();
    const rpcPayload = {p_client_request_id:requestId,p_product_id:selected.id,p_quantity:qty};
    const online = await getNetworkStatus();
    if (!online) {
      const available = Number(selected.stock);
      if (Number.isFinite(available) && qty > available) return Alert.alert('Not enough saved stock', 'The quantity is greater than the stock currently saved on this device.');
      const unitPrice = Number(selected.price || 0);
      const unitCost = Number(selected.cost || 0);
      const localSale = {
        id:requestId, product_id:selected.id, products:{name:selected.name},
        quantity:qty, total_amount:unitPrice*qty, profit:(unitPrice-unitCost)*qty,
        created_at:new Date().toISOString(), pending_sync:true
      };
      const updatedProducts = products.map(product => product.id === selected.id
        ? {...product, stock:Math.max(0,Number(product.stock || 0)-qty)}
        : product);
      const updatedSales = [localSale,...sales];
      await addPendingOperation(session.user.id,{type:'rpc',table:'record_sale',recordId:requestId,payload:{rpcPayload,localRecord:localSale}});
      setProducts(updatedProducts); setSales(updatedSales);
      await Promise.all([
        saveCachedRecords(session.user.id,'products',updatedProducts),
        saveCachedRecords(session.user.id,'sales',updatedSales)
      ]);
      await updatePendingCount();
      setSelected(null); setQuantity('1');
      Alert.alert('Sale saved on this device','This sale is waiting to sync. Stock will be checked again by the server when the connection returns.');
      return;
    }
    const {error} = await supabase.rpc('record_sale_idempotent', rpcPayload);
    if (error) return Alert.alert('Sale not recorded', error.message);
    setSelected(null); setQuantity('1'); refresh();
    Alert.alert('Sale recorded', 'Stock has been updated.');
  }
  async function addExpense() {
    const amount = Number(expenseAmount);
    if (!expenseText.trim() || !Number.isFinite(amount) || amount <= 0) return Alert.alert('Check details', 'Enter an expense description and a valid amount.');
    const online = await getNetworkStatus();
    if (!online) {
      const record = {id:makeLocalId(), description:expenseText.trim(), amount, created_by:session.user.id, created_at:new Date().toISOString(), created_by_name:profile?.full_name || ''};
      await addPendingOperation(session.user.id, {type:'upsert', table:'expenses', recordId:record.id, payload:{record, baseRecord:null}});
      const next=[record,...expenses]; setExpenses(next);
      await saveCachedRecords(session.user.id,'expenses',next); await updatePendingCount();
      setExpenseText(''); setExpenseAmount('');
      Alert.alert('Expense saved on this device','This expense will sync when internet returns.');
      return;
    }
    const {error} = await supabase.from('expenses').insert({description:expenseText.trim(), amount, created_by:session.user.id});
    if (error) return Alert.alert('Could not save expense', error.message);
    setExpenseText(''); setExpenseAmount(''); refresh();
  }

  function newBooking() {
    setBookingCustomer(null); setBookingCustomerSearch(''); setBookingProductSearch('');
    setBookingProduct(null); setBookingQty('1'); setBookingItems([]); setBookingNotes('');
    setBookingModal(true);
  }
  function addBookingItem() {
    const qty = parseInt(bookingQty, 10);
    if (!bookingProduct) return Alert.alert('Choose a product', 'Select a product first.');
    if (!Number.isInteger(qty) || qty < 1) return Alert.alert('Invalid quantity', 'Enter a quantity of at least 1.');
    const existing = bookingItems.find(x => x.product_id === bookingProduct.id);
    setBookingItems(old => existing
      ? old.map(x => x.product_id === bookingProduct.id ? {...x, quantity:x.quantity + qty} : x)
      : [...old, {product_id:bookingProduct.id, name:bookingProduct.name, quantity:qty, price:Number(bookingProduct.price || 0)}]);
    setBookingProduct(null); setBookingQty('1');
  }
  async function saveBooking() {
    if (!bookingCustomer) return Alert.alert('Choose a customer', 'Select a customer for this order.');
    if (!bookingItems.length) return Alert.alert('Add products', 'Add at least one product to the order.');
    const clientRequestId = makeLocalId();
    const online = await getNetworkStatus();
    const rpcPayload = {
      p_customer_id:bookingCustomer.id,
      p_items:bookingItems.map(x => {
        const product = products.find(p => p.id === x.product_id);
        return {
          product_id:x.product_id, quantity:x.quantity,
          product_name:x.name, selling_price:Number(x.price || 0),
          cost_price:Number(product?.cost || 0)
        };
      }),
      p_notes:bookingNotes || null,
      p_client_request_id:clientRequestId,
      p_use_snapshots:!online
    };
    if (!online) {
      const localItems = bookingItems.map(x => {
        const product = products.find(p => p.id === x.product_id);
        const cost = Number(product?.cost || 0);
        return {
          id:makeLocalId(), booking_id:clientRequestId, product_id:x.product_id,
          product_name:x.name, quantity:x.quantity, selling_price:Number(x.price || 0),
          cost_price:cost, selling_subtotal:Number(x.price || 0)*x.quantity,
          cost_subtotal:cost*x.quantity
        };
      });
      const localBooking = {
        id:clientRequestId, client_request_id:clientRequestId,
        reference_number:'PENDING-' + clientRequestId.slice(0,8).toUpperCase(),
        customer_id:bookingCustomer.id, customers:{name:bookingCustomer.name},
        status:'PENDING', total_selling:localItems.reduce((n,x)=>n+x.selling_subtotal,0),
        total_cost:localItems.reduce((n,x)=>n+x.cost_subtotal,0),
        notes:bookingNotes || null, created_at:new Date().toISOString(),
        created_by:session.user.id, created_by_name:profile?.full_name || '',
        is_offline_pending:true, local_items:localItems
      };
      await addPendingOperation(session.user.id, {
        type:'rpc', table:'create_booking', recordId:clientRequestId, payload:{rpcPayload, localBooking}
      });
      const next = [localBooking, ...bookings];
      setBookings(next); await saveCachedRecords(session.user.id, 'bookings', next);
      await updatePendingCount();
      setBookingModal(false);
      setBookingDetail(localBooking); setBookingDetailItems(localItems);
      Alert.alert('Order saved on this device', 'This order has a temporary reference until it syncs. Its permanent order number will be assigned by the server.');
      return;
    }
    const {data, error} = await supabase.rpc('create_booking', rpcPayload);
    if (error) return Alert.alert('Order not created', error.message);
    setBookingModal(false); await refresh();
    const {data:saved, error:loadError} = await supabase.from('bookings').select('*, customers(name)').eq('id', data).single();
    if (loadError || !saved) return Alert.alert('Order saved', 'Your order was saved, but its details could not be opened.');
    await openBooking(saved);
  }
  async function openBooking(item) {
    setBookingDetail(item);
    if (item.is_offline_pending && Array.isArray(item.local_items)) {
      setBookingDetailItems(item.local_items);
      return;
    }
    const cacheKey = 'booking_items_' + item.id;
    const online = await getNetworkStatus();
    if (online) {
      const {data, error} = await supabase.from('booking_items').select('*').eq('booking_id', item.id).order('created_at');
      if (!error) {
        setBookingDetailItems(data || []);
        await saveCachedRecords(session.user.id, cacheKey, data || []);
        return;
      }
    }
    const cachedItems = await readCachedRecords(session.user.id, cacheKey);
    setBookingDetailItems(cachedItems || []);
    if (cachedItems === null) Alert.alert('Order items unavailable offline', 'Open this order once while online to save its details on this device.');
  }
  async function updateBookingStatus(item, status) {
    const {error} = await supabase.from('bookings').update({status}).eq('id', item.id);
    if (error) return Alert.alert('Could not update order', error.message);
    const {data} = await supabase.from('bookings').select('*, customers(name)').eq('id', item.id).single();
    await refresh(); if (data) await openBooking(data);
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
    if (!(await getNetworkStatus())) return Alert.alert('Internet required for invoices','The invoice numbering and stock/amount records are managed by the server. This invoice has not been created.');
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
    const linesKey='invoice_items_'+item.id;
    const paymentsKey='invoice_payments_'+item.id;
    const online=await getNetworkStatus();
    if (online) {
      const [lines,pays]=await Promise.all([
        supabase.from('invoice_items').select('*').eq('invoice_id',item.id).order('id'),
        supabase.from('payments').select('*').eq('invoice_id',item.id).order('created_at',{ascending:false})
      ]);
      if(!lines.error && !pays.error) {
        setInvoiceLines(lines.data||[]); setInvoicePayments(pays.data||[]);
        await Promise.all([
          saveCachedRecords(session.user.id,linesKey,lines.data||[]),
          saveCachedRecords(session.user.id,paymentsKey,pays.data||[])
        ]);
        await saveCachedRecords(session.user.id,'invoice_detail_'+item.id,item);
        return;
      }
    }
    const [cachedLines,cachedPayments,cachedInvoice]=await Promise.all([
      readCachedRecords(session.user.id,linesKey),
      readCachedRecords(session.user.id,paymentsKey),
      readCachedRecords(session.user.id,'invoice_detail_'+item.id)
    ]);
    setInvoiceLines(cachedLines||[]);
    setInvoicePayments(cachedPayments||[]);
    if(cachedInvoice) setInvoiceDetail(cachedInvoice);
    if(cachedLines===null || cachedPayments===null) Alert.alert('Some invoice details are unavailable offline','Open this invoice while online once to save its items and payment history on this device.');
  }
  async function confirmInvoice() {
    if (!invoiceDetail) return;
    if (!(await getNetworkStatus())) return Alert.alert('Internet required','The invoice signature and confirmation must be submitted online. Your invoice remains unchanged.');
    if (!signaturePath.trim()) return Alert.alert('Customer signature needed', 'Ask the customer to sign in the signature box first.');
    const {error} = await supabase.from('invoices').update({customer_signature:signaturePath, confirmed_at:new Date().toISOString(), confirmed_by:session.user.id}).eq('id', invoiceDetail.id);
    if (error) return Alert.alert('Could not confirm invoice', error.message);
    const {data, error: refreshError} = await supabase.from('invoices').select('*, customers(name,address)').eq('id', invoiceDetail.id).single();
    if (refreshError) return Alert.alert('Invoice confirmed', 'The invoice was confirmed, but could not be refreshed. Close and reopen it to continue to payment.');
    if (!data) return Alert.alert('Invoice confirmed', 'The invoice was confirmed, but its details could not be refreshed. Close and reopen it to continue to payment.');
    setSignaturePath('');
    openPaymentScreen(data);
  }
  function openPaymentScreen(invoice = invoiceDetail) {
    if (invoice) setInvoiceDetail(invoice);
    setPaymentMethod('CASH'); setCashCounts({1000:'0',500:'0',200:'0',100:'0',50:'0',20:'0',10:'0',5:'0',1:'0',0.25:'0'});
    setCashReceived(''); setGcashSenderName(''); setGcashSenderNumber(''); setGcashReceiverNumber(''); setGcashReference(''); setPaymentError('');
    setPaymentScreen(true);
  }
  async function submitInvoicePayment(receivedOverride) {
    if (paymentBusy) return;
    if (!(await getNetworkStatus())) { setPaymentError('Internet connection required. No payment has been recorded.'); return; }
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
        Alert.alert('Payment saved', 'The payment was recorded, but the invoice print dialog could not open. You can try again later. ' + (printError?.message || ''));      }
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
    const online = await getNetworkStatus();
    if (!online) {
      const record = editingVendor ? {...editingVendor,...payload} : {...payload,id:makeLocalId()};
      await addPendingOperation(session.user.id,{type:'upsert',table:'vendors',recordId:record.id,payload:{record,baseRecord:editingVendor||null}});
      const next=editingVendor?vendors.map(x=>x.id===editingVendor.id?record:x):[...vendors,record];
      setVendors(next); await saveCachedRecords(session.user.id,'vendors',next); await updatePendingCount();
      setVendorModal(false);
      Alert.alert('Vendor saved on this device','This change will sync when internet returns.');
      return;
    }
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
        const online=await getNetworkStatus();
        if(!online) {
          await addPendingOperation(session.user.id,{type:'delete',table:'vendors',recordId:item.id,payload:{baseRecord:item}});
          const next=vendors.filter(x=>x.id!==item.id);
          setVendors(next); await saveCachedRecords(session.user.id,'vendors',next); await updatePendingCount();
          Alert.alert('Delete queued','The vendor will be deleted when internet returns.');
          return;
        }
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
    const online = await getNetworkStatus();
    if (!online) {
      const record = editingCustomer
        ? {...editingCustomer, ...payload}
        : {...payload, id:makeLocalId(), created_by:session.user.id};
      await addPendingOperation(session.user.id, {
        type:'upsert', table:'customers', recordId:record.id,
        payload:{record, baseRecord:editingCustomer || null}
      });
      const next = editingCustomer ? customers.map(x=>x.id===editingCustomer.id?record:x) : [...customers,record];
      setCustomers(next); await saveCachedRecords(session.user.id, 'customers', next);
      await updatePendingCount(); setCustomerModal(false);
      Alert.alert('Saved on this device', 'This customer change is queued and will sync when internet returns.');
      return;
    }
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
        const online = await getNetworkStatus();
        if (!online) {
          await addPendingOperation(session.user.id, {type:'delete', table:'customers', recordId:item.id, payload:{baseRecord:item}});
          const next = customers.filter(x=>x.id!==item.id);
          setCustomers(next); await saveCachedRecords(session.user.id, 'customers', next);
          await updatePendingCount();
          Alert.alert('Delete queued', 'The customer is removed from this device and will sync when internet returns.');
          return;
        }
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

  return <SafeAreaView style={styles.page}><StatusBar style="dark"/><View style={styles.header}><View><Text style={styles.heading}>EAN Marketing</Text><Text style={styles.sub}>{profile.full_name || profile.role}</Text>{!isOnline&&<Text style={styles.note}>Offline · showing saved records</Text>}{pendingSyncCount>0&&<Text style={styles.note}>{pendingSyncCount} change(s) waiting to sync</Text>}</View><TouchableOpacity onPress={signOut}><Text style={styles.link}>Sign out</Text></TouchableOpacity></View>    {tab!=='Home'&&<TouchableOpacity style={styles.homeLink} onPress={()=>setTab('Home')}><Text style={styles.link}>‹ Home</Text></TouchableOpacity>}
    {tab==='Home'&&<View style={styles.dashboard}>
      {[
        ['Products','▦'],['Sales','₱'],['Booking / Orders','🛒'],['Booking Search','⌕'],
        ['Customers','♙'],['Billing','▤'],['Reports','▥'],
        ...(isAdmin?[['Vendors','♧'],['Expenses','−'],['Settings','⚙']]:[])
      ].map(([name,symbol])=><TouchableOpacity key={name} style={styles.featureTile} onPress={()=>setTab(name==='Booking / Orders'?'Orders':name==='Booking Search'?'Booking Search':name==='Settings'?'Settings':name)}>
        <Text style={styles.featureIcon}>{symbol}</Text><Text style={styles.featureName}>{name}</Text>
      </TouchableOpacity>)}
    </View>}
    {tab==='Orders'&&<View style={styles.flex}>
      <TouchableOpacity style={styles.primary} onPress={newBooking}><Text style={styles.primaryText}>+ Create booking / order</Text></TouchableOpacity>
      <FlatList data={bookings} keyExtractor={x=>x.id} onRefresh={refresh} refreshing={false} ListEmptyComponent={<Text style={styles.note}>No bookings yet.</Text>} renderItem={({item})=><TouchableOpacity style={styles.line} onPress={()=>openBooking(item)}>
        <View style={styles.flex}><Text style={styles.productName}>{item.reference_number}</Text><Text style={styles.note}>{item.customers?.name || 'Customer'} · {new Date(item.created_at).toLocaleDateString()}</Text><Text style={styles.note}>{item.status} · {money(item.total_selling)}</Text></View>
      </TouchableOpacity>}/>
    </View>}
    {tab==='Booking Search'&&<View style={styles.flex}>
      <TextInput style={styles.input} placeholder="Enter booking reference (e.g. ORD-000001)" autoCapitalize="characters" value={bookingSearch} onChangeText={setBookingSearch}/>
      <FlatList data={bookings.filter(x=>(x.reference_number || '').toLowerCase().includes(bookingSearch.trim().toLowerCase()))} keyExtractor={x=>x.id} ListEmptyComponent={<Text style={styles.note}>{bookingSearch.trim()?'No matching booking reference.':'Enter a reference number to search.'}</Text>} renderItem={({item})=><TouchableOpacity style={styles.line} onPress={()=>openBooking(item)}>
        <View style={styles.flex}><Text style={styles.productName}>{item.reference_number}</Text><Text style={styles.note}>{item.customers?.name || 'Customer'} · {new Date(item.created_at).toLocaleDateString()}</Text></View><Text style={styles.link}>View</Text>
      </TouchableOpacity>}/>
    </View>}
    {tab==='Settings'&&<View style={styles.line}><View style={styles.flex}><Text style={styles.productName}>Admin Settings</Text><Text style={styles.note}>User management and access controls are not enabled yet.</Text></View></View>}
    {tab==='Products' && <View style={styles.flex}><TextInput style={styles.input} placeholder="Search name, SKU, category…" value={search} onChangeText={setSearch}/>{canAddProducts&&<TouchableOpacity style={styles.primary} onPress={newProduct}><Text style={styles.primaryText}>+ Add product</Text></TouchableOpacity>}<FlatList data={filtered} keyExtractor={x=>x.id} onRefresh={refresh} refreshing={false} ListEmptyComponent={<Text style={styles.note}>No products yet.</Text>} renderItem={({item})=><TouchableOpacity style={styles.product} onPress={()=>{setSelected(item);setQuantity('1')}}>{item.image_url?<Image source={{uri:item.image_url}} style={styles.thumb}/>:<View style={styles.thumbPlaceholder}><Text>Photo</Text></View>}<View style={styles.flex}><Text style={styles.productName}>{item.name}</Text><Text style={styles.note}>{item.sku || item.category || 'No SKU'} · Stock: {item.stock}</Text><Text style={styles.price}>{money(item.price)}</Text></View></TouchableOpacity>}/></View>}
    {tab==='Sales' && <FlatList data={sales} keyExtractor={x=>x.id} onRefresh={refresh} refreshing={false} ListEmptyComponent={<Text style={styles.note}>No sales recorded yet.</Text>} renderItem={({item})=><View style={styles.line}><View style={styles.flex}><Text style={styles.productName}>{item.products?.name || 'Product'}</Text><Text style={styles.note}>Qty: {item.quantity} · {new Date(item.created_at).toLocaleString()}</Text></View><Text style={styles.price}>{money(item.total_amount)}</Text></View>}/>}
    {tab==='Billing'&&<View style={styles.flex}><TextInput style={styles.input} placeholder="Search invoice number or customer…" value={billingSearch} onChangeText={setBillingSearch}/><TouchableOpacity style={styles.primary} onPress={newInvoice}><Text style={styles.primaryText}>+ Create invoice</Text></TouchableOpacity><FlatList data={invoices.filter(x=>[x.invoice_number,x.customers?.name,x.payment_status].join(' ').toLowerCase().includes(billingSearch.toLowerCase()))} keyExtractor={x=>x.id} onRefresh={refresh} refreshing={false} ListEmptyComponent={<Text style={styles.note}>No matching invoices.</Text>} renderItem={({item})=><TouchableOpacity style={styles.line} onPress={()=>openInvoice(item)}><View style={styles.flex}><Text style={styles.productName}>{item.invoice_number}</Text><Text style={styles.note}>{item.customers?.name || 'Customer'} · {new Date(item.created_at).toLocaleDateString()}</Text><Text style={styles.note}>{item.payment_status} · Balance: {money(item.balance)}</Text></View><Text style={styles.price}>{money(item.total)}</Text></TouchableOpacity>}/></View>}
    {tab==='Vendors'&&isAdmin&&<View style={styles.flex}><TextInput style={styles.input} placeholder="Search vendor or contact…" value={vendorSearch} onChangeText={setVendorSearch}/><TouchableOpacity style={styles.primary} onPress={newVendor}><Text style={styles.primaryText}>+ Add vendor</Text></TouchableOpacity><FlatList data={vendors.filter(x=>[x.name,x.contact_person,x.phone,x.email].join(' ').toLowerCase().includes(vendorSearch.toLowerCase()))} keyExtractor={x=>x.id} onRefresh={refresh} refreshing={false} ListEmptyComponent={<Text style={styles.note}>No vendors yet.</Text>} renderItem={({item})=><View style={styles.line}><View style={styles.flex}><Text style={styles.productName}>{item.name}</Text><Text style={styles.note}>{item.contact_person || 'No contact person'} {item.phone ? '· '+item.phone : ''}</Text>{item.email ? <Text style={styles.note}>{item.email}</Text> : null}{item.address ? <Text style={styles.note}>{item.address}</Text> : null}</View><View><TouchableOpacity onPress={()=>editVendor(item)}><Text style={styles.link}>Edit</Text></TouchableOpacity><TouchableOpacity onPress={()=>deleteVendor(item)}><Text style={{color:'#c62828',padding:8}}>Delete</Text></TouchableOpacity></View></View>}/></View>}
    {tab==='Customers' && <View style={styles.flex}>
      {selectedCustomerHistory ? <>        <TouchableOpacity style={styles.secondary} onPress={()=>setSelectedCustomerHistory(null)}><Text>← Back to customers</Text></TouchableOpacity>
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
    <Modal visible={!!selected} animationType="slide" onRequestClose={()=>setSelected(null)}><SafeAreaView style={styles.modal}><ScrollView>{selected?.image_url&&<Image source={{uri:selected.image_url}} style={styles.hero}/>}<Text style={styles.heading}>{selected?.name}</Text><Text style={styles.note}>{selected?.sku} {selected?.category}</Text><Text style={styles.body}>{selected?.description}</Text><Text style={styles.price}>{money(selected?.price)} · Stock: {selected?.stock}</Text>{isAdmin&&<><TouchableOpacity style={styles.secondary} onPress={()=>editProduct(selected)}><Text>Edit product</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={()=>deleteProduct(selected)}><Text style={{color:'#c62828'}}>Delete product</Text></TouchableOpacity></>}<Text style={styles.label}>Quantity to sell</Text><TextInput style={styles.input} keyboardType="number-pad" value={quantity} onChangeText={setQuantity}/><TouchableOpacity style={styles.primary} onPress={recordSale}><Text style={styles.primaryText}>Record sale</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={()=>setSelected(null)}><Text>Close</Text></TouchableOpacity></ScrollView></SafeAreaView></Modal>
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
    <Modal visible={bookingModal} animationType="slide" onRequestClose={()=>setBookingModal(false)}><SafeAreaView style={styles.modal}><ScrollView>
      <Text style={styles.heading}>Create booking / order</Text>
      <Text style={styles.label}>Select customer</Text><TextInput style={styles.input} placeholder="Search customer name…" value={bookingCustomerSearch} onChangeText={setBookingCustomerSearch}/>
      {bookingCustomer ? <View style={[styles.line,styles.selectedLine]}><Text style={styles.flex}>Customer: {bookingCustomer.name}</Text><TouchableOpacity onPress={()=>{setBookingCustomer(null);setBookingCustomerSearch('');}}><Text style={styles.link}>Change</Text></TouchableOpacity></View> : bookingCustomerSearch.trim() ? customers.filter(x=>x.name.toLowerCase().includes(bookingCustomerSearch.toLowerCase())).slice(0,8).map(x=><TouchableOpacity key={x.id} style={styles.line} onPress={()=>{setBookingCustomer(x);setBookingCustomerSearch(x.name);}}><Text style={styles.flex}>{x.name}</Text><Text style={styles.link}>Select</Text></TouchableOpacity>) : null}
      <Text style={styles.label}>Select product</Text><TextInput style={styles.input} placeholder="Search product name or SKU…" value={bookingProductSearch} onChangeText={setBookingProductSearch}/>
      {bookingProductSearch.trim() ? products.filter(x=>[x.name,x.sku].join(' ').toLowerCase().includes(bookingProductSearch.toLowerCase())).slice(0,10).map(x=><TouchableOpacity key={x.id} style={[styles.line,bookingProduct?.id===x.id&&styles.selectedLine]} onPress={()=>setBookingProduct(x)}><View style={styles.flex}><Text style={styles.productName}>{x.name}</Text><Text style={styles.note}>Selling price: {money(x.price)} · Stock: {x.stock}</Text></View><Text style={styles.link}>{bookingProduct?.id===x.id?'Selected':'Select'}</Text></TouchableOpacity>) : null}
      {bookingProduct&&<View style={[styles.line,styles.selectedLine]}><Text style={styles.flex}>Selected: {bookingProduct.name}</Text><TouchableOpacity onPress={()=>setBookingProduct(null)}><Text style={styles.link}>Change</Text></TouchableOpacity></View>}
      <TextInput style={styles.input} placeholder="Quantity" keyboardType="number-pad" value={bookingQty} onChangeText={setBookingQty}/><TouchableOpacity style={styles.secondary} onPress={addBookingItem}><Text>Add selected product</Text></TouchableOpacity>
      {bookingItems.map(x=><View key={x.product_id} style={styles.line}><Text style={styles.flex}>{x.name} × {x.quantity}</Text><Text>{money(x.price*x.quantity)}</Text><TouchableOpacity onPress={()=>setBookingItems(old=>old.filter(y=>y.product_id!==x.product_id))}><Text style={{color:'#c62828',paddingLeft:8}}>Remove</Text></TouchableOpacity></View>)}
      <View style={styles.line}><Text style={styles.flex}>Selling total</Text><Text style={styles.price}>{money(bookingItems.reduce((sum,x)=>sum+x.price*x.quantity,0))}</Text></View>
      <Text style={styles.note}>Cost prices are saved as snapshots when the order is created.</Text><Text style={styles.label}>Notes (optional)</Text><TextInput style={styles.input} value={bookingNotes} onChangeText={setBookingNotes} multiline/>
      <TouchableOpacity style={styles.primary} onPress={saveBooking}><Text style={styles.primaryText}>Save booking / order</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={()=>setBookingModal(false)}><Text>Cancel</Text></TouchableOpacity>
    </ScrollView></SafeAreaView></Modal>
    <Modal visible={!!bookingDetail} animationType="slide" onRequestClose={()=>setBookingDetail(null)}><SafeAreaView style={styles.modal}><ScrollView>
      <Text style={styles.heading}>{bookingDetail?.reference_number}</Text><Text style={styles.note}>Customer: {bookingDetail?.customers?.name || 'Customer'}</Text><Text style={styles.note}>Order date: {bookingDetail?.created_at ? new Date(bookingDetail.created_at).toLocaleString() : ''}</Text><Text style={styles.note}>Added by: {bookingDetail?.created_by_name || 'Unknown'}</Text>
      <Text style={styles.label}>Status: {bookingDetail?.status}</Text>
      {['PENDING','CONFIRMED','COMPLETED','CANCELLED'].map(s=><TouchableOpacity key={s} style={[styles.secondary,{borderColor:bookingDetail?.status===s?'#2457c5':'#cbd2dc'}]} onPress={()=>updateBookingStatus(bookingDetail,s)}><Text>{s===bookingDetail?.status?'✓ ':''}{s}</Text></TouchableOpacity>)}
      <Text style={styles.label}>Order items · Selling prices</Text>{bookingDetailItems.map(x=><View key={x.id} style={styles.line}><View style={styles.flex}><Text style={styles.productName}>{x.product_name}</Text><Text style={styles.note}>{x.quantity} × {money(x.selling_price)}</Text></View><Text>{money(x.selling_subtotal)}</Text></View>)}
      <View style={styles.line}><Text style={styles.flex}>Total selling amount</Text><Text style={styles.metric}>{money(bookingDetail?.total_selling)}</Text></View>
      {tab==='Booking Search'&&<><Text style={styles.label}>Cost breakdown</Text>{bookingDetailItems.map(x=><View key={'cost-'+x.id} style={styles.line}><View style={styles.flex}><Text style={styles.productName}>{x.product_name}</Text><Text style={styles.note}>{x.quantity} × {money(x.cost_price)}</Text></View><Text>{money(x.cost_subtotal)}</Text></View>)}<View style={styles.line}><Text style={styles.flex}>Total cost</Text><Text style={styles.metric}>{money(bookingDetail?.total_cost)}</Text></View></>}
      <TouchableOpacity style={styles.secondary} onPress={()=>setBookingDetail(null)}><Text>Close</Text></TouchableOpacity>
    </ScrollView></SafeAreaView></Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page:{flex:1,backgroundColor:'#f7f8fa',padding:14}, homeLink:{paddingVertical:2,marginBottom:2}, dashboard:{flex:1,flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',alignContent:'flex-start',paddingTop:8}, featureTile:{width:'31.5%',minHeight:112,backgroundColor:'#fff',borderRadius:12,marginBottom:10,alignItems:'center',justifyContent:'center',padding:8,borderWidth:1,borderColor:'#e3e7ee'}, featureIcon:{fontSize:34,color:'#2457c5',fontWeight:'700',marginBottom:8}, featureName:{fontSize:13,fontWeight:'700',color:'#1e293b',textAlign:'center'}, center:{flex:1,justifyContent:'center',alignItems:'center',padding:24,backgroundColor:'#f7f8fa'}, flex:{flex:1}, header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:16}, heading:{fontSize:25,fontWeight:'800',color:'#14213d'}, sub:{color:'#657080',marginTop:3}, tabs:{flexDirection:'row',marginBottom:14,borderBottomWidth:1,borderColor:'#dce1e8'}, tab:{paddingVertical:10,paddingHorizontal:12}, selectedLine:{borderWidth:1,borderColor:'#2457c5'}, activeTab:{borderBottomWidth:3,borderColor:'#2457c5'}, tabText:{color:'#687386'},activeTabText:{color:'#2457c5',fontWeight:'700'}, input:{backgroundColor:'#fff',borderWidth:1,borderColor:'#dce1e8',borderRadius:9,padding:11,marginVertical:4},primary:{backgroundColor:'#2457c5',padding:13,borderRadius:9,alignItems:'center',marginVertical:7},primaryText:{color:'#fff',fontWeight:'700'},secondary:{padding:13,borderRadius:9,borderWidth:1,borderColor:'#cbd2dc',alignItems:'center',marginVertical:7},link:{color:'#2457c5',fontWeight:'600',padding:8},note:{color:'#687386',fontSize:13,marginTop:4},product:{backgroundColor:'#fff',padding:8,marginVertical:2,borderRadius:10,flexDirection:'row',alignItems:'center',gap:12},thumb:{width:64,height:64,borderRadius:8,backgroundColor:'#e7eaf0'},thumbPlaceholder:{width:64,height:64,borderRadius:8,backgroundColor:'#e7eaf0',alignItems:'center',justifyContent:'center'},productName:{fontWeight:'700',fontSize:16,color:'#1e293b'},price:{fontWeight:'700',color:'#2457c5',marginTop:5},line:{backgroundColor:'#fff',padding:10,borderRadius:9,marginVertical:2,flexDirection:'row',alignItems:'center',gap:12},report:{backgroundColor:'#fff',padding:20,borderRadius:12},metricLabel:{color:'#687386',marginTop:12},metric:{fontSize:23,fontWeight:'800',color:'#14213d'},modal:{flex:1,padding:18,backgroundColor:'#f7f8fa'},invoiceTotals:{backgroundColor:'#fff',padding:14,borderRadius:10,marginTop:14},invoiceTotalRow:{flexDirection:'row',justifyContent:'space-between',paddingVertical:7},invoiceGrandLabel:{fontWeight:'800',fontSize:17,color:'#14213d'},signatureRow:{flexDirection:'row',gap:16,marginTop:34},signatureCell:{flex:1,alignItems:'center'},signatureLine:{height:1,backgroundColor:'#344054',alignSelf:'stretch',marginBottom:8,marginTop:20},signatureName:{fontWeight:'700',textAlign:'center',color:'#14213d'},invoiceDate:{textAlign:'center',marginTop:20,color:'#344054',fontWeight:'600'},hero:{width:'100%',height:230,borderRadius:12,marginBottom:16},label:{fontWeight:'700',marginTop:14},body:{marginVertical:12,color:'#344054'},});