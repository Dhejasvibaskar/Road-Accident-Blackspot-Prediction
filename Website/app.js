
"use strict";

/* ==================================================
   ROAD COLLISION BLACKSPOT EXPLORER
   Interactive Route and Historical Blackspot Analysis

   Dataset: UK Road Collisions, 2021-2025
   ================================================== */


// ==================================================
// 1. WEBSITE ELEMENTS
// ==================================================

const statusElement = document.getElementById("status");
const searchButton = document.getElementById("searchBtn");
const sampleButton = document.getElementById("sampleBtn");

const startInput = document.getElementById("start");
const endInput = document.getElementById("end");

const distanceElement = document.getElementById("distance");
const totalElement = document.getElementById("total");
const veryHighElement = document.getElementById("veryHigh");
const mediumElement = document.getElementById("medium");

// Historical blackspot data
let blackspots = [];


// ==================================================
// 2. INITIALIZE LEAFLET MAP
// ==================================================

const map = L.map("map").setView(
    [51.5074, -0.1278],
    12
);

// Working OpenStreetMap tile provider
L.tileLayer(
    "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    {
        attribution:
            "&copy; OpenStreetMap contributors, HOT",
        maxZoom: 19
    }
).addTo(map);

// Separate layers for routes and markers
const markerLayer = L.layerGroup().addTo(map);

let routeLayer = null;


// ==================================================
// 3. LOAD HISTORICAL BLACKSPOT DATA
// ==================================================

searchButton.disabled = true;
sampleButton.disabled = true;

async function loadBlackspots() {

    statusElement.textContent =
        "Loading historical collision data...";

    try {

        const response = await fetch("blackspots.json");

        if (!response.ok) {
            throw new Error(
                "Unable to load blackspots.json."
            );
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error(
                "Invalid blackspot data format."
            );
        }

        if (data.length === 0) {
            throw new Error(
                "The blackspot dataset is empty."
            );
        }

        blackspots = data;

        console.log(
            "Historical blackspots loaded:",
            blackspots.length
        );

        statusElement.textContent =
            `${blackspots.length.toLocaleString()} ` +
            "historical blackspots loaded. Ready to search.";

        searchButton.disabled = false;
        sampleButton.disabled = false;

    } catch (error) {

        console.error("Data loading error:", error);

        statusElement.textContent =
            "Unable to load historical collision data. " +
            error.message;

    }
}


// ==================================================
// 4. CONVERT UK PLACE NAMES TO COORDINATES
// ==================================================

function delay(milliseconds) {
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
}

async function getCoordinates(place) {

    const url = new URL(
        "https://nominatim.openstreetmap.org/search"
    );

    url.searchParams.set("q", place);
    url.searchParams.set("format", "json");
    url.searchParams.set("countrycodes", "gb");
    url.searchParams.set("limit", "1");

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            "Location search service is unavailable."
        );
    }

    const results = await response.json();

    if (!Array.isArray(results) || results.length === 0) {
        throw new Error(
            "Location not found: " + place
        );
    }

    const latitude = Number(results[0].lat);
    const longitude = Number(results[0].lon);

    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
    ) {
        throw new Error(
            "Invalid coordinates returned for " + place
        );
    }

    return [latitude, longitude];
}


// ==================================================
// 5. CALCULATE DRIVING ROUTE USING OSRM
// ==================================================

async function getDrivingRoute(start, end) {

    const startLat = start[0];
    const startLon = start[1];

    const endLat = end[0];
    const endLon = end[1];

    const url =
        "https://router.project-osrm.org/route/v1/driving/" +
        `${startLon},${startLat};${endLon},${endLat}` +
        "?overview=full&geometries=geojson";

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            "Driving route service is unavailable."
        );
    }

    const data = await response.json();

    if (
        data.code !== "Ok" ||
        !Array.isArray(data.routes) ||
        data.routes.length === 0
    ) {
        throw new Error(
            "No driving route found between these locations."
        );
    }

    const selectedRoute = data.routes[0];

    // OSRM returns [longitude, latitude].
    // Leaflet requires [latitude, longitude].
    const routePoints =
        selectedRoute.geometry.coordinates.map(
            coordinate => [
                coordinate[1],
                coordinate[0]
            ]
        );

    if (routePoints.length < 2) {
        throw new Error(
            "The routing service returned an invalid route."
        );
    }

    const distanceKm = selectedRoute.distance / 1000;

    return {
        points: routePoints,
        distanceKm: distanceKm
    };
}


// ==================================================
// 6. DISTANCE FROM BLACKSPOT TO ROUTE SEGMENT
// ==================================================

function distanceToSegmentMeters(
    point,
    segmentStart,
    segmentEnd
) {

    const earthRadius = 6371000;
    const radians = Math.PI / 180;

    const referenceLatitude = point[0] * radians;

    // Convert geographic coordinates to local metres
    function project(coordinate) {

        return {
            x:
                (coordinate[1] - point[1]) *
                radians *
                earthRadius *
                Math.cos(referenceLatitude),

            y:
                (coordinate[0] - point[0]) *
                radians *
                earthRadius
        };
    }

    const a = project(segmentStart);
    const b = project(segmentEnd);

    const dx = b.x - a.x;
    const dy = b.y - a.y;

    const lengthSquared = dx * dx + dy * dy;

    // Handle zero-length segments
    if (lengthSquared === 0) {
        return Math.hypot(a.x, a.y);
    }

    // Find closest point on the segment
    const t = Math.max(
        0,
        Math.min(
            1,
            -(a.x * dx + a.y * dy) / lengthSquared
        )
    );

    const closestX = a.x + t * dx;
    const closestY = a.y + t * dy;

    return Math.hypot(closestX, closestY);
}


// ==================================================
// 7. DETECT BLACKSPOTS NEAR THE ROUTE
// ==================================================

function findNearbyBlackspots(
    routePoints,
    maxDistance = 100
) {

    const nearby = [];

    if (routePoints.length < 2) {
        return nearby;
    }

    // Find the route's geographic bounds
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;

    for (const point of routePoints) {

        minLat = Math.min(minLat, point[0]);
        maxLat = Math.max(maxLat, point[0]);

        minLon = Math.min(minLon, point[1]);
        maxLon = Math.max(maxLon, point[1]);
    }

    // Convert search distance into approximate degrees
    const latitudePadding =
        (maxDistance / 111000) * 1.2;

    const maximumAbsoluteLatitude = Math.max(
        Math.abs(minLat),
        Math.abs(maxLat)
    );

    const longitudePadding =
        (maxDistance /
            (
                111000 *
                Math.max(
                    0.2,
                    Math.cos(
                        maximumAbsoluteLatitude *
                        Math.PI / 180
                    )
                )
            )
        ) * 1.2;

    // Expand route bounds
    minLat -= latitudePadding;
    maxLat += latitudePadding;

    minLon -= longitudePadding;
    maxLon += longitudePadding;

    // Check each historical blackspot
    for (const spot of blackspots) {

        const latitude = Number(spot.latitude);
        const longitude = Number(spot.longitude);

        // Skip invalid coordinates
        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            continue;
        }

        // Skip locations outside the route area
        if (
            latitude < minLat ||
            latitude > maxLat ||
            longitude < minLon ||
            longitude > maxLon
        ) {
            continue;
        }

        const blackspotPoint = [
            latitude,
            longitude
        ];

        let nearestDistance = Infinity;

        // Find the nearest route segment
        for (
            let i = 0;
            i < routePoints.length - 1;
            i++
        ) {

            const segmentStart = routePoints[i];
            const segmentEnd = routePoints[i + 1];

            // Fast geographical filtering
            if (
                latitude <
                    Math.min(
                        segmentStart[0],
                        segmentEnd[0]
                    ) - latitudePadding ||

                latitude >
                    Math.max(
                        segmentStart[0],
                        segmentEnd[0]
                    ) + latitudePadding ||

                longitude <
                    Math.min(
                        segmentStart[1],
                        segmentEnd[1]
                    ) - longitudePadding ||

                longitude >
                    Math.max(
                        segmentStart[1],
                        segmentEnd[1]
                    ) + longitudePadding
            ) {
                continue;
            }

            const distance = distanceToSegmentMeters(
                blackspotPoint,
                segmentStart,
                segmentEnd
            );

            if (distance < nearestDistance) {
                nearestDistance = distance;
            }
        }

        // Store spots within 100 metres
        if (nearestDistance <= maxDistance) {

            nearby.push({
                ...spot,
                latitude: latitude,
                longitude: longitude,
                distanceToRoute: nearestDistance
            });

        }
    }

    return nearby;
}


// ==================================================
// 8. DISPLAY COLOURED BLACKSPOT MARKERS
// ==================================================

function displayBlackspots(nearby) {

    const riskColors = {
        "Very High": "#8b2424",
        "Medium": "#d34739",
        "Detected": "#e58a24"
    };

    for (const spot of nearby) {

        const risk = [
            "Very High",
            "Medium",
            "Detected"
        ].includes(spot.risk_level)
            ? spot.risk_level
            : "Detected";

        const color = riskColors[risk];

        const collisionCount =
            Number(spot.collision_count);

        const severityScore =
            Number(spot.total_severity_score);

        const popupContent = `
            <div>
                <strong>
                    Historical Collision Blackspot
                </strong>
                <hr>
                <strong>Risk category:</strong>
                ${risk}
                <br>

                <strong>Recorded collisions:</strong>
                ${collisionCount}
                <br>

                <strong>Severity score:</strong>
                ${severityScore}
                <br>

                <strong>Distance from route:</strong>
                ${spot.distanceToRoute.toFixed(1)} metres
            </div>
        `;

        L.circleMarker(
            [
                spot.latitude,
                spot.longitude
            ],
            {
                radius: 8,
                color: "#ffffff",
                weight: 1.5,
                fillColor: color,
                fillOpacity: 0.95
            }
        )
        .bindPopup(popupContent)
        .bindTooltip(`${risk} Blackspot`)
        .addTo(markerLayer);
    }
}


// ==================================================
// 9. UPDATE ROUTE STATISTICS
// ==================================================

function updateStatistics(route, nearby) {

    const veryHighCount = nearby.filter(
        spot => spot.risk_level === "Very High"
    ).length;

    const mediumCount = nearby.filter(
        spot => spot.risk_level === "Medium"
    ).length;

    distanceElement.textContent =
        route.distanceKm.toFixed(2) + " km";

    totalElement.textContent =
        nearby.length.toLocaleString();

    veryHighElement.textContent =
        veryHighCount.toLocaleString();

    mediumElement.textContent =
        mediumCount.toLocaleString();
}


// ==================================================
// 10. RESET STATISTICS
// ==================================================

function resetStatistics() {

    distanceElement.textContent = "--";
    totalElement.textContent = "--";
    veryHighElement.textContent = "--";
    mediumElement.textContent = "--";
}


// ==================================================
// 11. MAIN ROUTE SEARCH FUNCTION
// ==================================================

// ==================================================
// SAMPLE ROUTE: OFFLINE DEMO OF ROUTE-BASED ANALYSIS
// Uses a saved route generated in the project; no geocoding
// or public route API is required for this demonstration.
// ==================================================

async function showSampleRoute() {
    sampleButton.disabled = true;
    searchButton.disabled = true;
    statusElement.textContent = "Loading a saved London route...";

    try {
        const response = await fetch("sample_route.json");
        if (!response.ok) throw new Error("Sample route could not be loaded.");
        const sample = await response.json();
        if (!Array.isArray(sample.points) || sample.points.length < 2 ||
            !Number.isFinite(sample.distanceKm)) {
            throw new Error("Sample route data is invalid.");
        }
        const route = {points: sample.points, distanceKm: sample.distanceKm};
        const nearby = findNearbyBlackspots(route.points, 100);
        if (routeLayer !== null) map.removeLayer(routeLayer);
        markerLayer.clearLayers();
        routeLayer = L.polyline(route.points, {
            color: "#245fc5", weight: 5, opacity: 0.9
        }).addTo(map);
        L.marker(route.points[0]).bindPopup("Saved route start").addTo(markerLayer);
        L.marker(route.points[route.points.length - 1])
            .bindPopup("Saved route destination").addTo(markerLayer);
        displayBlackspots(nearby);
        map.fitBounds(routeLayer.getBounds(), {padding: [30, 30]});
        updateStatistics(route, nearby);
        statusElement.textContent = `Sample analysis loaded: ${nearby.length} historical blackspots within 100 metres of the saved route. Enter your own route to search live.`;
    } catch (error) {
        console.error("Sample route error:", error);
        statusElement.textContent = "Unable to load sample route: " + error.message;
    } finally {
        sampleButton.disabled = false;
        searchButton.disabled = false;
    }
}



async function searchRoute() {

    const startingPlace = startInput.value.trim();
    const destinationPlace = endInput.value.trim();

    if (!startingPlace || !destinationPlace) {

        statusElement.textContent =
            "Please enter both starting and " +
            "destination locations.";

        return;
    }

    // Prevent duplicate searches
    searchButton.disabled = true;

    statusElement.textContent =
        "Searching for locations and calculating route...";

    try {

        // Step 1: Convert starting location
        const start = await getCoordinates(
            startingPlace
        );

        // Respect public geocoding request limits
        await delay(1100);

        // Step 2: Convert destination
        const end = await getCoordinates(
            destinationPlace
        );

        // Step 3: Calculate driving route
        statusElement.textContent =
            "Calculating driving route...";

        const route = await getDrivingRoute(
            start,
            end
        );

        // Step 4: Find nearby historical blackspots
        statusElement.textContent =
            "Analysing historical collision blackspots...";

        const nearby = findNearbyBlackspots(
            route.points,
            100
        );

        // Step 5: Remove previous map results
        if (routeLayer !== null) {
            map.removeLayer(routeLayer);
        }

        markerLayer.clearLayers();

        // Step 6: Draw driving route
        routeLayer = L.polyline(
            route.points,
            {
                color: "#245fc5",
                weight: 5,
                opacity: 0.9
            }
        ).addTo(map);

        // Step 7: Mark starting location
        L.marker(start)
            .bindPopup("Starting point")
            .bindTooltip("START")
            .addTo(markerLayer);

        // Step 8: Mark destination
        L.marker(end)
            .bindPopup("Destination")
            .bindTooltip("DESTINATION")
            .addTo(markerLayer);

        // Step 9: Display historical blackspots
        displayBlackspots(nearby);

        // Step 10: Fit map around the route
        map.fitBounds(
            routeLayer.getBounds(),
            {
                padding: [30, 30]
            }
        );

        // Step 11: Update dashboard
        updateStatistics(route, nearby);

        // Step 12: Display final status
        statusElement.textContent =
            "Route analysed successfully. " +
            `${nearby.length} historical blackspots ` +
            "found within approximately 100 metres.";

        console.log(
            "Driving distance:",
            route.distanceKm.toFixed(2),
            "km"
        );

        console.log(
            "Nearby historical blackspots:",
            nearby.length
        );

        console.log(
            "Very High:",
            nearby.filter(
                spot => spot.risk_level === "Very High"
            ).length
        );

        console.log(
            "Medium:",
            nearby.filter(
                spot => spot.risk_level === "Medium"
            ).length
        );

        console.log(
            "Detected:",
            nearby.filter(
                spot => spot.risk_level === "Detected"
            ).length
        );

    } catch (error) {

        console.error(
            "Route search error:",
            error
        );

        statusElement.textContent =
            "Unable to complete route search: " +
            error.message;

    } finally {

        searchButton.disabled = false;

    }
}


// ==================================================
// 12. ACTIVATE SEARCH BUTTON
// ==================================================

searchButton.addEventListener(
    "click",
    searchRoute
);

sampleButton.addEventListener("click", showSampleRoute);


// ==================================================
// 13. INITIALIZE WEBSITE
// ==================================================

resetStatistics();

loadBlackspots();
