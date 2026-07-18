const adminCredentials = { role: 'admin', name: 'Admin' };
const defaultMedicines = [
  { id: 1, name: 'Fipronil', stock: 16 },
  { id: 2, name: 'Imidacloprid', stock: 9 },
  { id: 3, name: 'Deltamethrin', stock: 0 },
  { id: 4, name: 'Cypermethrin', stock: 3 }
];

const storage = {
  load(key, fallback) {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  },
  save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

const elements = {
  loginSection: document.getElementById('loginSection'),
  dashboardSection: document.getElementById('dashboardSection'),
  userBadge: document.getElementById('userBadge'),
  loginRole: document.getElementById('loginRole'),
  loginName: document.getElementById('loginName'),
  loginButton: document.getElementById('loginButton'),
  logoutButton: document.getElementById('logoutButton'),
  statTotal: document.getElementById('statTotal'),
  statInStock: document.getElementById('statInStock'),
  statOutOfStock: document.getElementById('statOutOfStock'),
  inventoryTable: document.getElementById('inventoryTable'),
  userPanel: document.getElementById('userPanel'),
  adminPanel: document.getElementById('adminPanel'),
  requestUserName: document.getElementById('requestUserName'),
  requestMedicine: document.getElementById('requestMedicine'),
  requestQuantity: document.getElementById('requestQuantity'),
  sendRequestButton: document.getElementById('sendRequestButton'),
  adminMedicineSelect: document.getElementById('adminMedicineSelect'),
  newMedicineName: document.getElementById('newMedicineName'),
  newMedicineStock: document.getElementById('newMedicineStock'),
  addMedicineButton: document.getElementById('addMedicineButton'),
  requestsTable: document.getElementById('requestsTable')
};

let inventory = storage.load('inventory', defaultMedicines);
let requests = storage.load('requests', []);
let currentUser = null;

function initialize() {
  elements.loginButton.addEventListener('click', handleLogin);
  elements.logoutButton.addEventListener('click', handleLogout);
  elements.sendRequestButton.addEventListener('click', handleSendRequest);
  elements.addMedicineButton.addEventListener('click', handleAddMedicine);
  elements.adminMedicineSelect.addEventListener('change', handleAdminMedicineChange);
  renderDashboard();
}

function handleLogin() {
  const role = elements.loginRole.value;
  const name = elements.loginName.value.trim() || (role === 'admin' ? 'Admin' : 'Field User');
  currentUser = { role, name };
  elements.loginSection.classList.add('hidden');
  elements.dashboardSection.classList.remove('hidden');
  elements.userBadge.textContent = `${name} • ${role.toUpperCase()}`;
  elements.userBadge.classList.remove('hidden');
  elements.requestUserName.value = name;
  renderDashboard();
}

function handleLogout() {
  currentUser = null;
  elements.loginSection.classList.remove('hidden');
  elements.dashboardSection.classList.add('hidden');
  elements.userBadge.classList.add('hidden');
  elements.loginName.value = '';
}

function handleAddMedicine() {
  const name = elements.newMedicineName.value.trim();
  const stock = Number(elements.newMedicineStock.value);
  if (!name) {
    alert('Enter a medicine name.');
    return;
  }
  if (!stock || stock <= 0) {
    alert('Enter a valid stock quantity.');
    return;
  }
  const selection = elements.adminMedicineSelect.value;
  if (selection !== 'new') {
    const existing = inventory.find(item => item.id === Number(selection));
    if (existing) {
      existing.stock += stock;
    }
  } else {
    const existing = inventory.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.stock += stock;
    } else {
      inventory.push({ id: Date.now(), name, stock });
    }
  }
  storage.save('inventory', inventory);
  elements.newMedicineName.value = '';
  elements.newMedicineStock.value = '10';
  renderDashboard();
}

function handleSendRequest() {
  const medicineId = Number(elements.requestMedicine.value);
  const quantity = Number(elements.requestQuantity.value);
  if (!medicineId || quantity < 1) {
    alert('Choose a medicine and enter a valid quantity.');
    return;
  }
  const medicine = inventory.find(item => item.id === medicineId);
  requests.push({ id: Date.now(), user: currentUser.name, medicine: medicine.name, quantity, status: 'Pending' });
  storage.save('requests', requests);
  elements.requestQuantity.value = '1';
  renderDashboard();
}

function approveRequest(requestId) {
  const request = requests.find(item => item.id === requestId);
  if (!request) return;
  const medicine = inventory.find(item => item.name === request.medicine);
  if (!medicine) {
    request.status = 'Rejected';
    storage.save('requests', requests);
    renderDashboard();
    return;
  }
  if (medicine.stock >= request.quantity) {
    medicine.stock -= request.quantity;
    request.status = 'Approved';
  } else {
    request.status = 'Rejected';
    alert(`Not enough stock to approve ${request.quantity} units of ${medicine.name}.`);
  }
  storage.save('inventory', inventory);
  storage.save('requests', requests);
  renderDashboard();
}

function handleAdminMedicineChange() {
  updateAdminMedicineField();
}

function updateAdminMedicineField() {
  const selection = elements.adminMedicineSelect.value;
  const existing = inventory.find(item => item.id === Number(selection));
  elements.newMedicineName.value = selection === 'new' ? '' : existing ? existing.name : '';
  elements.newMedicineName.disabled = selection !== 'new';
}

function renderDashboard() {
  const totalMedicines = inventory.length;
  const inStockCount = inventory.reduce((sum, item) => sum + item.stock, 0);
  const outOfStockCount = inventory.filter(item => item.stock === 0).length;
  elements.statTotal.textContent = totalMedicines;
  elements.statInStock.textContent = inStockCount;
  elements.statOutOfStock.textContent = outOfStockCount;

  elements.inventoryTable.innerHTML = inventory.map(item => {
    const statusClass = item.stock > 0 ? 'status-available' : 'status-out';
    const statusLabel = item.stock > 0 ? 'Available' : 'Stocked out';
    return `<tr><td>${item.name}</td><td>${item.stock}</td><td class="${statusClass}">${statusLabel}</td></tr>`;
  }).join('');

  elements.adminMedicineSelect.innerHTML = [
    '<option value="new">Add new medicine</option>',
    ...inventory.map(item => `<option value="${item.id}">${item.name} (${item.stock} in stock)</option>`)
  ].join('');
  updateAdminMedicineField();

  elements.requestMedicine.innerHTML = inventory.map(item => {
    const disabled = item.stock === 0 ? 'disabled' : '';
    return `<option value="${item.id}" ${disabled}>${item.name} ${item.stock === 0 ? '(Out of stock)' : ''}</option>`;
  }).join('');

  if (currentUser) {
    const isAdmin = currentUser.role === 'admin';
    elements.userPanel.classList.toggle('hidden', isAdmin);
    elements.adminPanel.classList.toggle('hidden', !isAdmin);
    elements.requestsTable.innerHTML = requests.map(request => {
      const statusClass = request.status === 'Approved' ? 'success' : request.status === 'Pending' ? 'pending' : 'warning';
      const actionCell = currentUser.role === 'admin' && request.status === 'Pending'
        ? `<button class="btn btn-secondary request-button" onclick="approveRequest(${request.id})">Approve</button>`
        : '-';
      return `
        <tr>
          <td>${request.user}</td>
          <td>${request.medicine}</td>
          <td>${request.quantity}</td>
          <td><span class="badge-pill ${statusClass}">${request.status}</span></td>
          <td>${actionCell}</td>
        </tr>`;
    }).join('');
  }
}

window.approveRequest = approveRequest;
initialize();
