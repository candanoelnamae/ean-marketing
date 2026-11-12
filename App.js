import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { supabase, supabaseConfigured } from './src/supabase';

const money = n => '₱' + Number(n || 0).toFixed(2);

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Products');
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerModal, setCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [customerForm, setCustomerForm] = useState({name:'', phone:'', email:'', address:'', notes:''});
  const [search, setSearch] = useState('');
  const [email, setEmail] = useState('');
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
    if (isAdmin) {
      const e = await supabase.from('expenses').select('*').order('created_at', {ascending:false}).limit(100);
      if (!e.error) setExpenses(e.data || []);
    }
  }

  async function signIn() {
    const {error} = await supabase.auth.signInWithPassword({email:email.trim(), password});
    if (error) Alert.alert('Login failed', error.message);
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
  if (!session) return <SafeAreaView style={styles.center}><StatusBar style="dark"/><Text style={styles.heading}>EAN Marketing</Text><Text style={styles.sub}>Sales & Inventory</Text><TextInput style={styles.input} placeholder="Email address" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail}/><TextInput style={styles.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword}/><TouchableOpacity style={styles.primary} onPress={signIn}><Text style={styles.primaryText}>Sign in</Text></TouchableOpacity></SafeAreaView>;
  if (!profile) return <SafeAreaView style={styles.center}><Text>Profile not found. Please contact your administrator.</Text><TouchableOpacity onPress={signOut}><Text style={styles.link}>Sign out</Text></TouchableOpacity></SafeAreaView>;

  const filtered = products.filter(p => [p.name,p.sku,p.category].join(' ').toLowerCase().includes(search.toLowerCase()));
  const totalSales = sales.reduce((n,s)=>n+Number(s.total_amount||0),0);
  const totalProfit = sales.reduce((n,s)=>n+Number(s.profit||0),0);
  const totalExpenses = expenses.reduce((n,e)=>n+Number(e.amount||0),0);

  return <SafeAreaView style={styles.page}><StatusBar style="dark"/><View style={styles.header}><View><Text style={styles.heading}>EAN Marketing</Text><Text style={styles.sub}>{profile.full_name || profile.role}</Text></View><TouchableOpacity onPress={signOut}><Text style={styles.link}>Sign out</Text></TouchableOpacity></View>
    <View style={styles.tabs}>{['Products','Sales','Customers','Reports',...(isAdmin?['Expenses']:[])].map(t=><TouchableOpacity key={t} onPress={()=>setTab(t)} style={[styles.tab,tab===t&&styles.activeTab]}><Text style={tab===t?styles.activeTabText:styles.tabText}>{t}</Text></TouchableOpacity>)}</View>
    {tab==='Products' && <View style={styles.flex}><TextInput style={styles.input} placeholder="Search name, SKU, category…" value={search} onChangeText={setSearch}/>{isAdmin&&<TouchableOpacity style={styles.primary} onPress={newProduct}><Text style={styles.primaryText}>+ Add product</Text></TouchableOpacity>}<FlatList data={filtered} keyExtractor={x=>x.id} onRefresh={refresh} refreshing={false} ListEmptyComponent={<Text style={styles.note}>No products yet.</Text>} renderItem={({item})=><TouchableOpacity style={styles.product} onPress={()=>{setSelected(item);setQuantity('1')}}>{item.image_url?<Image source={{uri:item.image_url}} style={styles.thumb}/>:<View style={styles.thumbPlaceholder}><Text>Photo</Text></View>}<View style={styles.flex}><Text style={styles.productName}>{item.name}</Text><Text style={styles.note}>{item.sku || item.category || 'No SKU'} · Stock: {item.stock}</Text><Text style={styles.price}>{money(item.price)}</Text></View></TouchableOpacity>}/></View>}
    {tab==='Sales' && <FlatList data={sales} keyExtractor={x=>x.id} onRefresh={refresh} refreshing={false} ListEmptyComponent={<Text style={styles.note}>No sales recorded yet.</Text>} renderItem={({item})=><View style={styles.line}><View style={styles.flex}><Text style={styles.productName}>{item.products?.name || 'Product'}</Text><Text style={styles.note}>Qty: {item.quantity} · {new Date(item.created_at).toLocaleString()}</Text></View><Text style={styles.price}>{money(item.total_amount)}</Text></View>}/>}
    {tab==='Customers' && <View style={styles.flex}><TextInput style={styles.input} placeholder="Search customer name, phone, email…" value={customerSearch} onChangeText={setCustomerSearch}/><TouchableOpacity style={styles.primary} onPress={newCustomer}><Text style={styles.primaryText}>+ Add customer</Text></TouchableOpacity><FlatList data={customers.filter(x=>[x.name,x.phone,x.email].join(' ').toLowerCase().includes(customerSearch.toLowerCase()))} keyExtractor={x=>x.id} onRefresh={refresh} refreshing={false} ListEmptyComponent={<Text style={styles.note}>No customers yet.</Text>} renderItem={({item})=><View style={styles.line}><View style={styles.flex}><Text style={styles.productName}>{item.name}</Text><Text style={styles.note}>{item.phone || 'No phone'} {item.email ? '· '+item.email : ''}</Text>{item.address ? <Text style={styles.note}>{item.address}</Text> : null}</View>{isAdmin&&<View><TouchableOpacity onPress={()=>editCustomer(item)}><Text style={styles.link}>Edit</Text></TouchableOpacity><TouchableOpacity onPress={()=>deleteCustomer(item)}><Text style={{color:'#c62828',padding:8}}>Delete</Text></TouchableOpacity></View>}</View>}/></View>}
    {tab==='Reports' && <View style={styles.report}><Text style={styles.metricLabel}>Recorded sales (latest 100)</Text><Text style={styles.metric}>{money(totalSales)}</Text><Text style={styles.metricLabel}>Gross profit</Text><Text style={styles.metric}>{money(totalProfit)}</Text>{isAdmin&&<><Text style={styles.metricLabel}>Expenses (latest 100)</Text><Text style={styles.metric}>{money(totalExpenses)}</Text><Text style={styles.metricLabel}>Profit after listed expenses</Text><Text style={styles.metric}>{money(totalProfit-totalExpenses)}</Text></>}</View>}
    {tab==='Expenses'&&isAdmin&&<View style={styles.flex}><TextInput style={styles.input} placeholder="Expense description" value={expenseText} onChangeText={setExpenseText}/><TextInput style={styles.input} placeholder="Amount (PHP)" keyboardType="decimal-pad" value={expenseAmount} onChangeText={setExpenseAmount}/><TouchableOpacity style={styles.primary} onPress={addExpense}><Text style={styles.primaryText}>Save expense</Text></TouchableOpacity><FlatList data={expenses} keyExtractor={x=>x.id} renderItem={({item})=><View style={styles.line}><Text style={styles.flex}>{item.description}</Text><Text>{money(item.amount)}</Text></View>}/></View>}
    <Modal visible={!!selected} animationType="slide" onRequestClose={()=>setSelected(null)}><SafeAreaView style={styles.modal}><ScrollView>{selected?.image_url&&<Image source={{uri:selected.image_url}} style={styles.hero}/>}<Text style={styles.heading}>{selected?.name}</Text><Text style={styles.note}>{selected?.sku} {selected?.category}</Text><Text style={styles.body}>{selected?.description}</Text><Text style={styles.price}>{money(selected?.price)} · Stock: {selected?.stock}</Text>{isAdmin&&<TouchableOpacity style={styles.secondary} onPress={()=>editProduct(selected)}><Text>Edit product</Text></TouchableOpacity>}<Text style={styles.label}>Quantity to sell</Text><TextInput style={styles.input} keyboardType="number-pad" value={quantity} onChangeText={setQuantity}/><TouchableOpacity style={styles.primary} onPress={recordSale}><Text style={styles.primaryText}>Record sale</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={()=>setSelected(null)}><Text>Close</Text></TouchableOpacity></ScrollView></SafeAreaView></Modal>
    <Modal visible={customerModal} animationType="slide" onRequestClose={()=>setCustomerModal(false)}><SafeAreaView style={styles.modal}><ScrollView><Text style={styles.heading}>{editingCustomer?'Edit customer':'Add customer'}</Text>{[['name','Customer name'],['phone','Phone'],['email','Email'],['address','Address'],['notes','Notes']].map(([k,label])=><TextInput key={k} style={styles.input} placeholder={label} value={customerForm[k]} onChangeText={v=>setCustomerForm(old=>({...old,[k]:v}))} multiline={k==='address'||k==='notes'}/>)}<TouchableOpacity style={styles.primary} onPress={saveCustomer}><Text style={styles.primaryText}>Save customer</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={()=>setCustomerModal(false)}><Text>Cancel</Text></TouchableOpacity></ScrollView></SafeAreaView></Modal>
    <Modal visible={edit} animationType="slide" onRequestClose={()=>setEdit(false)}><SafeAreaView style={styles.modal}><ScrollView><Text style={styles.heading}>{selected?'Edit product':'Add product'}</Text>{[['name','Product name'],['sku','SKU'],['category','Category'],['description','Description'],['price','Selling price'],['cost','Cost'],['stock','Stock quantity']].map(([k,label])=><TextInput key={k} style={styles.input} placeholder={label} value={form[k]} onChangeText={v=>setForm(old=>({...old,[k]:v}))} keyboardType={['price','cost','stock'].includes(k)?'decimal-pad':'default'}/>)}<TouchableOpacity style={styles.secondary} onPress={choosePhoto}><Text>Choose product photo</Text></TouchableOpacity>{form.image_url&&<Image source={{uri:form.image_url}} style={styles.thumb}/>}<TouchableOpacity style={styles.primary} onPress={saveProduct}><Text style={styles.primaryText}>Save product</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={()=>setEdit(false)}><Text>Cancel</Text></TouchableOpacity></ScrollView></SafeAreaView></Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page:{flex:1,backgroundColor:'#f7f8fa',padding:16}, center:{flex:1,justifyContent:'center',alignItems:'center',padding:24,backgroundColor:'#f7f8fa'}, flex:{flex:1}, header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:16}, heading:{fontSize:25,fontWeight:'800',color:'#14213d'}, sub:{color:'#657080',marginTop:3}, tabs:{flexDirection:'row',marginBottom:14,borderBottomWidth:1,borderColor:'#dce1e8'}, tab:{paddingVertical:10,paddingHorizontal:12}, activeTab:{borderBottomWidth:3,borderColor:'#2457c5'}, tabText:{color:'#687386'},activeTabText:{color:'#2457c5',fontWeight:'700'}, input:{backgroundColor:'#fff',borderWidth:1,borderColor:'#dce1e8',borderRadius:9,padding:12,marginVertical:6},primary:{backgroundColor:'#2457c5',padding:13,borderRadius:9,alignItems:'center',marginVertical:7},primaryText:{color:'#fff',fontWeight:'700'},secondary:{padding:13,borderRadius:9,borderWidth:1,borderColor:'#cbd2dc',alignItems:'center',marginVertical:7},link:{color:'#2457c5',fontWeight:'600',padding:8},note:{color:'#687386',fontSize:13,marginTop:4},product:{backgroundColor:'#fff',padding:10,marginVertical:5,borderRadius:10,flexDirection:'row',alignItems:'center',gap:12},thumb:{width:64,height:64,borderRadius:8,backgroundColor:'#e7eaf0'},thumbPlaceholder:{width:64,height:64,borderRadius:8,backgroundColor:'#e7eaf0',alignItems:'center',justifyContent:'center'},productName:{fontWeight:'700',fontSize:16,color:'#1e293b'},price:{fontWeight:'700',color:'#2457c5',marginTop:5},line:{backgroundColor:'#fff',padding:14,borderRadius:9,marginVertical:4,flexDirection:'row',alignItems:'center',gap:12},report:{backgroundColor:'#fff',padding:20,borderRadius:12},metricLabel:{color:'#687386',marginTop:12},metric:{fontSize:23,fontWeight:'800',color:'#14213d'},modal:{flex:1,padding:18,backgroundColor:'#f7f8fa'},hero:{width:'100%',height:230,borderRadius:12,marginBottom:16},label:{fontWeight:'700',marginTop:14},body:{marginVertical:12,color:'#344054'},});
