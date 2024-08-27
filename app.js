// Initialize map and other global variables
let map;
let destinations = [];
let totalDistance = 0;
let markers = [];
let routeLine;

// Add these variables at the top of the file
let history = [];
let historyIndex = -1;

// Add this new section for the Data Persistence Feature
const DataPersistence = {
    save: function(key, value, expirationInSeconds = null) {
        const item = {
            value: value,
            timestamp: new Date().getTime()
        };
        
        if (expirationInSeconds) {
            item.expiration = expirationInSeconds * 1000; // Convert to milliseconds
        }
        
        localStorage.setItem(key, JSON.stringify(item));
    },
    
    load: function(key) {
        const item = localStorage.getItem(key);
        if (!item) return null;
        
        const parsedItem = JSON.parse(item);
        const now = new Date().getTime();
        
        if (parsedItem.expiration && now - parsedItem.timestamp > parsedItem.expiration) {
            localStorage.removeItem(key);
            return null;
        }
        
        return parsedItem.value;
    },
    
    remove: function(key) {
        localStorage.removeItem(key);
    },
    
    clear: function() {
        localStorage.clear();
    }
};

// Update the loadSavedData function
function loadSavedData() {
    const savedDestinations = DataPersistence.load('destinations');
    const savedHistory = DataPersistence.load('history');
    const savedHistoryIndex = DataPersistence.load('historyIndex');
    
    if (savedDestinations) {
        destinations = savedDestinations;
    }
    
    if (savedHistory) {
        history = savedHistory;
    }
    
    if (savedHistoryIndex !== null) {
        historyIndex = savedHistoryIndex;
    }
    
    updateDestinationList();
    updateMap();
    updateUndoRedoButtons();
}

// Update the saveData function
function saveData() {
    DataPersistence.save('destinations', destinations);
    DataPersistence.save('history', history);
    DataPersistence.save('historyIndex', historyIndex);
}

// Initialize the application
function init() {
    // Initialize Leaflet map
    map = L.map('map-container').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    
    loadSavedData();
    
    document.getElementById('add-btn').addEventListener('click', addDestination);
    document.getElementById('destination-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            addDestination();
        }
    });
    
    const input = document.getElementById('destination-input');
    input.addEventListener('input', handleAutocomplete);
    
    // Add this new event listener
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#add-destination')) {
            closeAutocompleteList();
        }
    });
    
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('redo-btn').addEventListener('click', redo);
    
    // Add click event listener to the map
    map.on('click', onMapClick);
    
    initSettings();
}

// Add this new section for the Geocoding Feature
const GeocodingAPI = {
    async geocode(query) {
        const cacheKey = `geocode:${query}`;
        const cachedResult = DataPersistence.load(cacheKey);
        
        if (cachedResult) {
            return cachedResult;
        }
        
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.length > 0) {
            const result = {
                name: data[0].display_name,
                lat: parseFloat(data[0].lat),
                lon: parseFloat(data[0].lon)
            };
            DataPersistence.save(cacheKey, result, 3600); // Cache for 1 hour
            return result;
        }
        
        return null;
    },
    
    async reverseGeocode(lat, lon) {
        const cacheKey = `reversegeocode:${lat},${lon}`;
        const cachedResult = DataPersistence.load(cacheKey);
        
        if (cachedResult) {
            return cachedResult;
        }
        
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.display_name) {
            const result = {
                name: data.display_name,
                address: data.address,
                lat: parseFloat(data.lat),
                lon: parseFloat(data.lon)
            };
            DataPersistence.save(cacheKey, result, 3600); // Cache for 1 hour
            return result;
        }
        
        return null;
    }
};

// Update the addDestination function to use the new GeocodingAPI
async function addDestination(suggestion = null) {
    const input = document.getElementById('destination-input');
    const destination = suggestion ? suggestion.display_name : input.value.trim();
    
    if (destination) {
        try {
            let geocodeResult;
            if (suggestion) {
                geocodeResult = { name: suggestion.display_name, lat: parseFloat(suggestion.lat), lon: parseFloat(suggestion.lon) };
            } else {
                geocodeResult = await GeocodingAPI.geocode(destination);
            }
            
            if (geocodeResult) {
                addToHistory({
                    type: 'add',
                    destination: geocodeResult
                });
                destinations.push(geocodeResult);
                updateDestinationList();
                updateMap();
                saveData();
                input.value = '';
            } else {
                alert('Location not found. Please try a different search term.');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('An error occurred while searching for the location.');
        }
    }
}

// Update the onMapClick function to use the new GeocodingAPI
async function onMapClick(e) {
    const { lat, lng } = e.latlng;
    
    const loadingPopup = L.popup()
        .setLatLng(e.latlng)
        .setContent('<div class="loading-spinner-container"><div class="loading-spinner"></div><p class="loading-text">Loading location info...</p></div>')
        .openOn(map);

    try {
        const geocodeResult = await GeocodingAPI.reverseGeocode(lat, lng);
        if (geocodeResult) {
            showLocationInfo(geocodeResult, e.latlng, loadingPopup);
        } else {
            loadingPopup.setContent("No information available for this location.");
        }
    } catch (error) {
        console.error('Error:', error);
        loadingPopup.setContent("Error fetching location information.");
    }
}

// Update the showLocationInfo function to use the new geocode result format
function showLocationInfo(data, latlng, loadingPopup) {
    const { name, address } = data;
    
    let content = `<div class="popup-content">`;
    content += `<h4>${name}</h4>`;
    content += '<table>';
    
    if (address) {
        const relevantInfo = [
            'road', 'house_number', 'neighbourhood', 'suburb', 
            'city', 'county', 'state', 'postcode', 'country'
        ];
        
        relevantInfo.forEach(key => {
            if (address[key]) {
                content += `<tr><td><strong>${key.charAt(0).toUpperCase() + key.slice(1)}:</strong></td><td>${address[key]}</td></tr>`;
            }
        });
    }
    
    content += `<tr><td><strong>Latitude:</strong></td><td>${latlng.lat.toFixed(6)}</td></tr>`;
    content += `<tr><td><strong>Longitude:</strong></td><td>${latlng.lng.toFixed(6)}</td></tr>`;
    content += '</table>';
    
    content += `<button class="add-to-itinerary-btn" onclick="addClickedLocation('${name}', ${latlng.lat}, ${latlng.lng})">Add to Itinerary</button>`;
    content += '</div>';

    loadingPopup.setContent(content);
}

// Update the destination list in the UI
function updateDestinationList() {
    const list = document.getElementById('destination-list');
    list.innerHTML = '';
    
    // Add a drop zone at the beginning
    addDropZone(list, 0);

    destinations.forEach((dest, index) => {
        // Add journey info before each destination (except the first one)
        if (index > 0) {
            const journeyInfo = createJourneyInfo(index);
            list.appendChild(journeyInfo);
        }

        const item = createDestinationItem(dest, index);
        list.appendChild(item);

        // Add a drop zone after each destination
        addDropZone(list, index + 1);
    });
    
    updateRouteInfo();
}

function addDropZone(list, index) {
    const dropZone = document.createElement('div');
    dropZone.className = 'drop-zone';
    dropZone.dataset.index = index;
    dropZone.addEventListener('dragover', dragOver);
    dropZone.addEventListener('drop', drop);
    dropZone.addEventListener('dragenter', dragEnter);
    dropZone.addEventListener('dragleave', dragLeave);
    list.appendChild(dropZone);
}

// Helper functions to create journey info and destination items
function createJourneyInfo(index) {
    const journeyInfo = document.createElement('div');
    journeyInfo.className = 'journey-info';
    journeyInfo.innerHTML = `
        <i class="fas fa-car"></i>
        <div class="journey-details">
            <p><span id="distance-${index}">Calculating...</span></p>
            <p><span id="duration-${index}">Calculating...</span></p>
        </div>
    `;
    return journeyInfo;
}

function createDestinationItem(dest, index) {
    const item = document.createElement('div');
    item.className = 'destination-item';
    if (index === 0) {
        item.classList.add('destination-item-first');
    }
    if (index === destinations.length - 1) {
        item.classList.add('destination-item-last');
    }
    item.draggable = true;
    item.dataset.index = index;

    const shortAddress = dest.name.split(',')[0].trim();
    
    item.innerHTML = `
        <div class="destination-content">
            <span class="destination-main">${shortAddress}</span>
            <span class="destination-full">${dest.name}</span>
        </div>
        <button class="remove-btn" onclick="removeDestination(${index})" aria-label="Remove destination">
            <i class="fas fa-trash-alt"></i>
        </button>
    `;
    
    item.addEventListener('dragstart', dragStart);
    item.addEventListener('dragend', dragEnd);
    
    return item;
}

// Remove a destination
function removeDestination(index) {
    addToHistory({
        type: 'remove',
        index: index,
        destination: destinations[index]
    });
    destinations.splice(index, 1);
    updateDestinationList();
    updateMap();
    saveData();
}

// Update the map with current destinations
function updateMap() {
    // Clear existing markers and route
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
    if (routeLine) map.removeLayer(routeLine);
    
    // Add markers for each destination
    destinations.forEach((dest, index) => {
        const marker = L.marker([dest.lat, dest.lon]).addTo(map);
        marker.bindPopup(`<b>${index + 1}. ${dest.name}</b>`);
        markers.push(marker);
    });
    
    // Update map bounds to fit all destinations
    if (destinations.length > 0) {
        const bounds = L.latLngBounds(destinations.map(dest => [dest.lat, dest.lon]));
        map.fitBounds(bounds, {padding: [50, 50]});
    }

    // Calculate and display route info
    updateRouteInfo();
}

// Add this function to calculate the route
async function calculateRoute() {
    if (destinations.length < 2) return null;

    const coordinates = destinations.map(dest => `${dest.lon},${dest.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.code !== 'Ok') {
            throw new Error('Unable to calculate route');
        }

        return data.routes[0];
    } catch (error) {
        console.error('Error calculating route:', error);
        return null;
    }
}

// Update the updateRouteInfo function
async function updateRouteInfo() {
    const route = await calculateRoute();
    
    if (route) {
        const totalDistance = formatDistance(route.distance / 1609.34); // Convert to miles
        const totalDuration = formatDuration(route.duration);

        document.getElementById('total-distance').textContent = totalDistance;
        document.getElementById('total-duration').textContent = totalDuration;

        // Update individual journey information
        route.legs.forEach((leg, index) => {
            const distanceElement = document.getElementById(`distance-${index + 1}`);
            const durationElement = document.getElementById(`duration-${index + 1}`);
            
            if (distanceElement && durationElement) {
                const legDistance = formatDistance(leg.distance / 1609.34); // Convert to miles
                const legDuration = formatDuration(leg.duration);
                
                distanceElement.textContent = legDistance;
                durationElement.textContent = legDuration;
            }
        });

        // Update the route on the map
        if (routeLine) map.removeLayer(routeLine);
        routeLine = L.geoJSON(route.geometry, {color: 'blue'}).addTo(map);
    } else {
        document.getElementById('total-distance').textContent = 'N/A';
        document.getElementById('total-duration').textContent = 'N/A';
    }
}

// Add this new function to format distance
function formatDistance(miles) {
    if (miles < 10) {
        return `${miles.toFixed(1)} mi`;
    } else {
        return `${Math.round(miles)} mi`;
    }
}

// Update the formatDuration function
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    
    if (hours === 0) {
        return `${minutes} min`;
    } else if (minutes === 0) {
        return `${hours} hr`;
    } else {
        return `${hours} hr ${minutes} min`;
    }
}

// Initialize the app when the page loads
window.onload = init;

let autocompleteTimeout;

function handleAutocomplete() {
    const input = document.getElementById('destination-input');
    const query = input.value.trim();

    clearTimeout(autocompleteTimeout);

    if (query.length < 3) return;

    autocompleteTimeout = setTimeout(() => {
        fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=8`)
            .then(response => response.json())
            .then(data => {
                showAutocompleteSuggestions(data);
            })
            .catch(error => {
                console.error('Autocomplete error:', error);
            });
    }, 300);
}

function showAutocompleteSuggestions(suggestions) {
    let autocompleteList = document.getElementById('autocomplete-list');
    if (!autocompleteList) {
        autocompleteList = document.createElement('ul');
        autocompleteList.id = 'autocomplete-list';
        document.getElementById('add-destination').appendChild(autocompleteList);
    }

    autocompleteList.innerHTML = '';

    suggestions.forEach(suggestion => {
        const li = document.createElement('li');
        li.textContent = suggestion.display_name;
        li.addEventListener('click', () => {
            document.getElementById('destination-input').value = suggestion.display_name;
            autocompleteList.innerHTML = '';
            addDestination(suggestion);
        });
        autocompleteList.appendChild(li);
    });
}

// Add this new function
function closeAutocompleteList() {
    const autocompleteList = document.getElementById('autocomplete-list');
    if (autocompleteList) {
        autocompleteList.remove();
    }
}

// Drag and drop functions
let draggedItem = null;

function dragStart(e) {
    draggedItem = e.target.closest('.destination-item');
    if (draggedItem) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedItem.dataset.index);
        draggedItem.style.opacity = '0.5';
    }
}

function dragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function drop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
    let toIndex = parseInt(e.target.dataset.index);
    
    // Adjust toIndex if dropping between destinations
    if (e.target.classList.contains('drop-zone') && toIndex > fromIndex) {
        toIndex--;
    }
    
    if (fromIndex !== toIndex) {
        addToHistory({
            type: 'reorder',
            fromIndex: fromIndex,
            toIndex: toIndex,
            destination: destinations[fromIndex]
        });
        // Reorder destinations array
        const [reorderedItem] = destinations.splice(fromIndex, 1);
        destinations.splice(toIndex, 0, reorderedItem);
        
        updateDestinationList();
        updateMap();
        saveData();
    }
    
    // Reset the opacity of the dragged item
    if (draggedItem) {
        draggedItem.style.opacity = '1';
    }
    draggedItem = null;
    
    // Remove drop-zone-active class from all drop zones
    document.querySelectorAll('.drop-zone').forEach(zone => {
        zone.classList.remove('drop-zone-active');
    });
}

function dragEnter(e) {
    e.target.classList.add('drop-zone-active');
}

function dragLeave(e) {
    e.target.classList.remove('drop-zone-active');
}

// Add this new function
function dragEnd(e) {
    if (draggedItem) {
        draggedItem.style.opacity = '1';
        draggedItem = null;
    }
}

// Add these new functions
function addToHistory(action) {
    history = history.slice(0, historyIndex + 1);
    history.push(action);
    historyIndex++;
    updateUndoRedoButtons();
}

function undo() {
    if (historyIndex >= 0) {
        const action = history[historyIndex];
        historyIndex--;
        
        switch (action.type) {
            case 'add':
                destinations.pop();
                break;
            case 'remove':
                destinations.splice(action.index, 0, action.destination);
                break;
            case 'reorder':
                const [item] = destinations.splice(action.toIndex, 1);
                destinations.splice(action.fromIndex, 0, item);
                break;
        }
        
        updateDestinationList();
        updateMap();
        saveData();
        updateUndoRedoButtons();
    }
}

function redo() {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        const action = history[historyIndex];
        
        switch (action.type) {
            case 'add':
                destinations.push(action.destination);
                break;
            case 'remove':
                destinations.splice(action.index, 1);
                break;
            case 'reorder':
                const [item] = destinations.splice(action.fromIndex, 1);
                destinations.splice(action.toIndex, 0, item);
                break;
        }
        
        updateDestinationList();
        updateMap();
        saveData();
        updateUndoRedoButtons();
    }
}

function updateUndoRedoButtons() {
    document.getElementById('undo-btn').disabled = historyIndex < 0;
    document.getElementById('redo-btn').disabled = historyIndex >= history.length - 1;
}

// Add this new function
function onMapClick(e) {
    const { lat, lng } = e.latlng;
    
    // Show loading popup immediately
    const loadingPopup = L.popup()
        .setLatLng(e.latlng)
        .setContent('<div class="loading-spinner-container"><div class="loading-spinner"></div><p class="loading-text">Loading location info...</p></div>')
        .openOn(map);

    // Use Nominatim API for reverse geocoding
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`)
        .then(response => response.json())
        .then(data => {
            if (data.display_name) {
                showLocationInfo(data, e.latlng, loadingPopup);
            } else {
                loadingPopup.setContent("No information available for this location.");
            }
        })
        .catch(error => {
            console.error('Error:', error);
            loadingPopup.setContent("Error fetching location information.");
        });
}

function showLocationInfo(data, latlng, loadingPopup) {
    const { address, display_name } = data;
    
    let content = `<div class="popup-content">`;
    content += `<h4>${display_name}</h4>`;
    content += '<table>';
    
    if (address) {
        const relevantInfo = [
            'road', 'house_number', 'neighbourhood', 'suburb', 
            'city', 'county', 'state', 'postcode', 'country'
        ];
        
        relevantInfo.forEach(key => {
            if (address[key]) {
                content += `<tr><td><strong>${key.charAt(0).toUpperCase() + key.slice(1)}:</strong></td><td>${address[key]}</td></tr>`;
            }
        });
    }
    
    content += `<tr><td><strong>Latitude:</strong></td><td>${latlng.lat.toFixed(6)}</td></tr>`;
    content += `<tr><td><strong>Longitude:</strong></td><td>${latlng.lng.toFixed(6)}</td></tr>`;
    content += '</table>';
    
    content += `<button class="add-to-itinerary-btn" onclick="addClickedLocation('${display_name}', ${latlng.lat}, ${latlng.lng})">Add to Itinerary</button>`;
    content += '</div>';

    // Update the content of the existing popup
    loadingPopup.setContent(content);
}

function addClickedLocation(name, lat, lon) {
    addToHistory({
        type: 'add',
        destination: { name, lat, lon }
    });
    destinations.push({ name, lat, lon });
    updateDestinationList();
    updateMap();
    saveData();

    // Close the popup
    map.closePopup();
}

// Add these new functions at the end of the file
function initSettings() {
    const settingsBtn = document.getElementById('settings-btn');
    settingsBtn.addEventListener('click', openSettingsModal);

    // Create settings modal
    const settingsModal = document.createElement('div');
    settingsModal.className = 'settings-modal';
    settingsModal.innerHTML = `
        <div class="settings-modal-content">
            <span class="close">&times;</span>
            <h2>Settings</h2>
            <div class="settings-description">
                Manage your application data and caches. Please use these options carefully as they can result in data loss.
            </div>
            <div>
                <button id="clear-caches-btn">Clear Caches</button>
                <p class="settings-description">
                    Clears all cached data, including autocomplete suggestions and geocoding results. This can help if you're experiencing issues with location searches.
                </p>
            </div>
            <div>
                <button id="reset-app-btn">Reset Application</button>
                <p class="settings-description">
                    Resets the entire application to its initial state. This will delete all your saved itineraries and cannot be undone.
                </p>
            </div>
        </div>
    `;
    document.body.appendChild(settingsModal);

    // Add event listeners for settings actions
    document.querySelector('.settings-modal .close').addEventListener('click', closeSettingsModal);
    document.getElementById('clear-caches-btn').addEventListener('click', clearCaches);
    document.getElementById('reset-app-btn').addEventListener('click', resetApplication);
}

function openSettingsModal() {
    document.querySelector('.settings-modal').style.display = 'block';
}

function closeSettingsModal() {
    document.querySelector('.settings-modal').style.display = 'none';
}

function clearCaches() {
    if (confirm('Are you sure you want to clear all caches? This action cannot be undone.')) {
        // Clear autocomplete suggestions cache
        DataPersistence.remove('autocomplete_suggestions');
        
        // Clear geocoding cache
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('geocode:') || key.startsWith('reversegeocode:')) {
                DataPersistence.remove(key);
            }
        });

        alert('All caches have been cleared.');
    }
}

function resetApplication() {
    if (confirm('Are you sure you want to reset the application? This will clear all data, including your saved itineraries. This action cannot be undone.')) {
        // Clear all application data
        DataPersistence.clear();

        // Reset global variables
        destinations = [];
        history = [];
        historyIndex = -1;

        // Update UI
        updateDestinationList();
        updateMap();
        updateUndoRedoButtons();

        alert('The application has been reset.');
        closeSettingsModal();
    }
}