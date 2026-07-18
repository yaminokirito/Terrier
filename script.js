import { firebaseConfig } from './firebaseConfig.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const elements = {
  loginSection: document.getElementById('loginSection'),
  dashboardSection: document.getElementById('dashboardSection'),
  googleLoginButton: document.getElementById('googleLoginButton'),
  logoutButton: document.getElementById('logoutButton'),
  userBadge: document.getElementById('userBadge'),
  requestUserName: document.getElementById('requestUserName'),
  requestMedicine: document.getElementById('requestMedicine'),
  requestQuantity: document.getElementById('requestQuantity'),
  sendRequestButton: document.getElementById('sendRequestButton'),
  adminPanel: document.getElementById('adminPanel'),
  userPanel: document.getElementById('userPanel'),
  adminMedicineSelect: document.getElementById('adminMedicineSelect'),
  newMedicineName: document.getElementById('newMedicineName'),
  newMedicineStock: document.getElementById('newMedicineStock'),
  addMedicineButton: document.getElementById('addMedicineButton'),
  inventoryTable: document.getElementById('inventoryTable'),
  requestsTable: document.getElementById('requestsTable'),
  statTotal: document.getElementById('statTotal'),
  statInStock: document.getElementById('statInStock'),
  statOutOfStock: document.getElementById('statOutOfStock')
};

let currentUser = null;
let inventory = [];
let requests = [];
let inventoryUnsubscribe = null;
let requestsUnsubscribe = null;

function showAlert(message) {
  alert(message);
}

function getUserDisplayName(userDoc, authUser) {
  if (userDoc && userDoc.displayName) {
    return userDoc.displayName;
  }
  if (authUser.displayName) {
    return authUser.displayName;
  }
  return authUser.email ? authUser.email.split('@')[0] : 'User';
}

async function initialize() {
  elements.googleLoginButton.addEventListener('click', handleGoogleLogin);
  elements.logoutButton.addEventListener('click', handleLogout);
  elements.sendRequestButton.addEventListener('click', handleSendRequest);
  elements.addMedicineButton.addEventListener('click', handleAddMedicine);
  elements.adminMedicineSelect.addEventListener('change', updateAdminMedicineField);

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      await loadUserProfile(user);
      await openDashboard();
    } else {
      currentUser = null;
      if (inventoryUnsubscribe) {
        inventoryUnsubscribe();
        inventoryUnsubscribe = null;
      }
      if (requestsUnsubscribe) {
        requestsUnsubscribe();
        requestsUnsubscribe = null;
      }
      showLogin();
    }
  });
}

function showLogin() {
  elements.loginSection.classList.remove('hidden');
  elements.dashboardSection.classList.add('hidden');
  elements.userBadge.classList.add('hidden');
}

function showDashboard() {
  elements.loginSection.classList.add('hidden');
  elements.dashboardSection.classList.remove('hidden');
  elements.userBadge.classList.remove('hidden');
}

async function handleGoogleLogin() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    await ensureUserDoc(result.user);
  } catch (error) {
    showAlert(error.message || 'Google sign-in failed.');
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
  } catch (error) {
    showAlert(error.message || 'Logout failed.');
  }
}

async function ensureUserDoc(user) {
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    const displayName = getUserDisplayName(null, user);
    await setDoc(userRef, {
      email: user.email || '',
      displayName,
      role: 'user',
      createdAt: serverTimestamp()
    });
  }
}

async function loadUserProfile(user) {
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    await ensureUserDoc(user);
    currentUser = {
      id: user.uid,
      email: user.email,
      displayName: getUserDisplayName(null, user),
      role: 'user'
    };
    return;
  }
  const userData = userSnap.data();
  currentUser = {
    id: user.uid,
    email: userData.email || user.email,
    displayName: getUserDisplayName(userData, user),
    role: userData.role || 'user'
  };
}

async function openDashboard() {
  showDashboard();
  elements.userBadge.textContent = `${currentUser.displayName} • ${currentUser.role.toUpperCase()}`;
  elements.requestUserName.value = currentUser.displayName;
  await loadDashboardData();
}

async function loadDashboardData() {
  if (inventoryUnsubscribe) {
    inventoryUnsubscribe();
  }
  if (requestsUnsubscribe) {
    requestsUnsubscribe();
  }

  const medicinesQuery = query(collection(db, 'medicines'), orderBy('name'));
  const requestsQuery = currentUser.role === 'admin'
    ? query(collection(db, 'requests'), orderBy('createdAt', 'desc'))
    : query(collection(db, 'requests'), where('userId', '==', currentUser.id));

  inventory = [];
  requests = [];
  renderDashboard();

  inventoryUnsubscribe = onSnapshot(medicinesQuery, (snapshot) => {
    inventory = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    renderDashboard();
  }, (error) => {
    console.error('Medicine snapshot failed:', error);
  });

  requestsUnsubscribe = onSnapshot(requestsQuery, (snapshot) => {
    requests = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    sortRequests();
    renderDashboard();
  }, (error) => {
    console.error('Request snapshot failed:', error);
    showAlert('Unable to load requests: ' + error.message);
  });

  try {
    const initialMedicineSnapshot = await getDocs(medicinesQuery);
    inventory = initialMedicineSnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
  } catch (error) {
    console.error('Initial medicines load failed:', error);
  }

  try {
    const initialRequestSnapshot = await getDocs(requestsQuery);
    requests = initialRequestSnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    if (requests.length === 0 && currentUser.email && currentUser.role !== 'admin') {
      const fallbackQuery = query(collection(db, 'requests'), where('userEmail', '==', currentUser.email));
      const fallbackSnapshot = await getDocs(fallbackQuery);
      if (fallbackSnapshot.docs.length > 0) {
        requests = fallbackSnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        console.warn('Used fallback request query by email for user', currentUser.email);
      }
    }
    sortRequests();
  } catch (error) {
    console.error('Initial requests load failed:', error);
    showAlert('Unable to load your requests: ' + error.message);
  }

  renderDashboard();
}

function sortRequests() {
  requests.sort((a, b) => {
    const aTime = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : a.createdAt || 0;
    const bTime = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : b.createdAt || 0;
    return bTime - aTime;
  });
}

async function handleAddMedicine() {
  const name = elements.newMedicineName.value.trim();
  const stock = Number(elements.newMedicineStock.value);
  const selection = elements.adminMedicineSelect.value;
  if (!stock || stock <= 0) {
    showAlert('Enter a valid stock quantity.');
    return;
  }
  try {
    if (selection === 'new') {
      if (!name) {
        showAlert('Enter a medicine name.');
        return;
      }
      await addDoc(collection(db, 'medicines'), {
        name,
        stock,
        createdAt: serverTimestamp()
      });
    } else {
      const medicine = inventory.find(item => item.id === selection);
      if (!medicine) {
        showAlert('Choose a valid medicine option.');
        return;
      }
      const medicineRef = doc(db, 'medicines', selection);
      await updateDoc(medicineRef, {
        stock: (medicine.stock || 0) + stock
      });
    }
    elements.newMedicineName.value = '';
    elements.newMedicineStock.value = '10';
    await loadDashboardData();
  } catch (error) {
    showAlert(error.message || 'Failed to update inventory.');
  }
}

async function handleSendRequest() {
  const medicineId = elements.requestMedicine.value;
  const quantity = Number(elements.requestQuantity.value);
  if (!medicineId || quantity < 1) {
    showAlert('Choose a medicine and enter a valid quantity.');
    return;
  }
  const medicine = inventory.find(item => item.id === medicineId);
  if (!medicine) {
    showAlert('Choose a valid medicine.');
    return;
  }
  try {
    await addDoc(collection(db, 'requests'), {
      userId: currentUser.id,
      userEmail: currentUser.email,
      userName: currentUser.displayName,
      medicineId,
      medicineName: medicine.name,
      quantity,
      status: 'Pending',
      createdAt: serverTimestamp()
    });
    elements.requestQuantity.value = '1';
    await loadDashboardData();
  } catch (error) {
    showAlert(error.message || 'Request failed.');
  }
}

async function approveRequest(requestId) {
  try {
    const requestRef = doc(db, 'requests', requestId);
    const requestSnap = await getDoc(requestRef);
    if (!requestSnap.exists()) {
      showAlert('Request not found.');
      return;
    }
    const requestData = requestSnap.data();
    if (requestData.status !== 'Pending') {
      showAlert('Request is already processed.');
      return;
    }
    const medicineRef = doc(db, 'medicines', requestData.medicineId);
    const medicineSnap = await getDoc(medicineRef);
    if (!medicineSnap.exists()) {
      showAlert('Medicine not found.');
      return;
    }
    const medicine = medicineSnap.data();
    await updateDoc(requestRef, {
      status: 'Approved',
      approvedAt: serverTimestamp()
    });
    await updateDoc(medicineRef, {
      stock: Math.max((medicine.stock || 0) - requestData.quantity, 0)
    });
    await loadDashboardData();
  } catch (error) {
    showAlert(error.message || 'Unable to approve request.');
  }
}

function updateAdminMedicineField() {
  const selection = elements.adminMedicineSelect.value;
  const medicine = inventory.find(item => item.id === selection);
  elements.newMedicineName.value = selection === 'new' ? '' : medicine ? medicine.name : '';
  elements.newMedicineName.disabled = selection !== 'new';
}

function renderDashboard() {
  const totalMedicines = inventory.length;
  const inStockCount = inventory.reduce((sum, item) => sum + Number(item.stock || 0), 0);
  const outOfStockCount = inventory.filter(item => Number(item.stock || 0) === 0).length;
  elements.statTotal.textContent = totalMedicines;
  elements.statInStock.textContent = inStockCount;
  elements.statOutOfStock.textContent = outOfStockCount;

  elements.inventoryTable.innerHTML = inventory.map(item => {
    const stockValue = Number(item.stock || 0);
    const statusClass = stockValue > 0 ? 'status-available' : 'status-out';
    const statusLabel = stockValue > 0 ? 'Available' : 'Stocked out';
    return `<tr><td>${item.name}</td><td>${stockValue}</td><td class="${statusClass}">${statusLabel}</td></tr>`;
  }).join('');

  elements.adminMedicineSelect.innerHTML = [
    '<option value="new">Add new medicine</option>',
    ...inventory.map(item => `<option value="${item.id}">${item.name} (${item.stock} in stock)</option>`)
  ].join('');
  updateAdminMedicineField();

  elements.requestMedicine.innerHTML = inventory.map(item => {
    const stockValue = Number(item.stock || 0);
    const disabled = stockValue === 0 ? 'disabled' : '';
    return `<option value="${item.id}" ${disabled}>${item.name} ${stockValue === 0 ? '(Out of stock)' : ''}</option>`;
  }).join('');

  if (!currentUser) {
    elements.requestsTable.innerHTML = '';
    return;
  }

  const isAdmin = currentUser.role === 'admin';
  elements.userPanel.classList.toggle('hidden', isAdmin);
  elements.adminPanel.classList.toggle('hidden', !isAdmin);

  if (requests.length === 0) {
    elements.requestsTable.innerHTML = `
      <tr>
        <td colspan="5" class="empty-row">No requests found.</td>
      </tr>`;
    return;
  }

  elements.requestsTable.innerHTML = requests.map(request => {
    const status = request.status || 'Pending';
    const statusClass = status === 'Approved' ? 'success' : status === 'Pending' ? 'pending' : 'warning';
    const actionCell = isAdmin && status === 'Pending'
      ? `<button class="btn btn-secondary request-button" onclick="approveRequest('${request.id}')">Approve</button>`
      : '-';
    const userName = request.userName || request.user || 'Unknown';
    const medicineName = request.medicineName || request.medicine || 'Unknown';
    const quantity = request.quantity || request.qty || 0;
    return `
      <tr>
        <td>${userName}</td>
        <td>${medicineName}</td>
        <td>${quantity}</td>
        <td><span class="badge-pill ${statusClass}">${status}</span></td>
        <td>${actionCell}</td>
      </tr>`;
  }).join('');
}

window.approveRequest = approveRequest;
initialize();
