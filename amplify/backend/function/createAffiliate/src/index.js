// AWS Amplify Lambda Function for Tapfiliate API Integration
// API key must be set as environment variable: TAPFILIATE_API_KEY
// This function replaces the Netlify serverless function with identical logic

const TAPFILIATE_BASE_URL = 'https://api.tapfiliate.com/1.6/';
const PROGRAM_ID_MAP = {
    'USD': 'stasher-affiliates-usd',
    'EUR': 'stasher-affiliate-program-sp',
    'GBP': 'stasher-affiliate-program',
    'AUD': 'jg-affiliate-program'
};

// Cache for custom field keys (fallback when env vars not set)
let customFieldsCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 300000; // 5 minutes

// Normalize field labels for resilient lookup (case/spacing-insensitive)
function normalizeFieldLabel(label) {
    return (label || '').trim().toLowerCase();
}

/**
 * Fetch custom field keys from Tapfiliate API (or read from env vars).
 * Returns a map of normalized field titles to field IDs.
 *
 * Set these env vars in the Lambda console to skip the extra API call:
 *   TAPFILIATE_FIELD_KEY_COMPANY_TYPE
 *   TAPFILIATE_FIELD_KEY_COMMISSION_TYPE
 *   TAPFILIATE_FIELD_KEY_DEMO_CALL
 */
async function getCustomFieldKeys(apiKey) {
    // Fast path: use environment variables if all three keys are configured
    const envCompanyType = process.env.TAPFILIATE_FIELD_KEY_COMPANY_TYPE;
    const envCommissionType = process.env.TAPFILIATE_FIELD_KEY_COMMISSION_TYPE;
    const envDemoCall = process.env.TAPFILIATE_FIELD_KEY_DEMO_CALL;

    if (envCompanyType && envCommissionType && envDemoCall) {
        console.log('✅ Using custom field keys from environment variables (no API call)');
        return {
            [normalizeFieldLabel('Company type')]: envCompanyType,
            [normalizeFieldLabel('Commission type')]: envCommissionType,
            [normalizeFieldLabel('Free DEMO call?')]: envDemoCall,
            [normalizeFieldLabel('Do you want a FREE DEMO call?')]: envDemoCall
        };
    }

    // Fallback: fetch from Tapfiliate API with caching
    const now = Date.now();
    const normalizedCommission = normalizeFieldLabel('Commission type');

    if (customFieldsCache && cacheTimestamp && (now - cacheTimestamp < CACHE_DURATION) && customFieldsCache[normalizedCommission]) {
        console.log('✅ Using cached custom field keys');
        return customFieldsCache;
    }

    console.log('🔍 Fetching custom field keys from Tapfiliate API (set env vars to skip this)...');

    try {
        const response = await fetch(`${TAPFILIATE_BASE_URL}affiliates/custom-fields/`, {
            method: 'GET',
            headers: {
                'X-Api-Key': apiKey,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error('⚠️ Failed to fetch custom fields:', response.status);
            return null;
        }

        const fields = await response.json();

        // Create a map: normalized title -> key (prefer field.key, fallback to id)
        const fieldMap = {};
        if (Array.isArray(fields)) {
            fields.forEach(field => {
                if (field.title && (field.key || field.id)) {
                    const normalizedTitle = normalizeFieldLabel(field.title);
                    fieldMap[normalizedTitle] = field.key || field.id;
                }
            });
        }

        customFieldsCache = fieldMap;
        cacheTimestamp = now;

        console.log('✅ Custom field keys fetched and cached:', fieldMap);
        if (!fieldMap[normalizedCommission]) {
            console.error('❌ "Commission type" not found in fetched custom fields. Available fields:', Object.keys(fieldMap));
        }
        return fieldMap;

    } catch (error) {
        console.error('❌ Error fetching custom fields:', error);
        return null;
    }
}

/**
 * Map custom field labels to their API keys
 */
function mapCustomFieldsToKeys(customFieldsObj, fieldKeyMap) {
    if (!customFieldsObj || typeof customFieldsObj !== 'object' || !fieldKeyMap) {
        return {};
    }
    
    const mappedFields = {};
    Object.keys(customFieldsObj).forEach(label => {
        const apiKey = fieldKeyMap[normalizeFieldLabel(label)];
        if (apiKey) {
            mappedFields[apiKey] = customFieldsObj[label];
        } else {
            console.warn(`⚠️ Custom field key not found for label: "${label}"`);
        }
    });
    
    return mappedFields;
}

// Helper function to map country names to ISO 3166-1 alpha-2 codes
function getCountryISOCode(countryName) {
    if (!countryName) return 'GB'; // Default to GB if no country
    
    const countryMap = {
        'United Kingdom': 'GB',
        'UK': 'GB',
        'United States': 'US',
        'USA': 'US',
        'US': 'US',
        'Canada': 'CA',
        'Australia': 'AU',
        'Germany': 'DE',
        'France': 'FR',
        'Spain': 'ES',
        'Italy': 'IT',
        'Netherlands': 'NL',
        'Belgium': 'BE',
        'Switzerland': 'CH',
        'Austria': 'AT',
        'Sweden': 'SE',
        'Norway': 'NO',
        'Denmark': 'DK',
        'Poland': 'PL',
        'Portugal': 'PT',
        'Ireland': 'IE',
        'Greece': 'GR',
        'Finland': 'FI',
        'Czech Republic': 'CZ',
        'Hungary': 'HU',
        'Romania': 'RO',
        'Bulgaria': 'BG',
        'Croatia': 'HR',
        'Slovakia': 'SK',
        'Slovenia': 'SI',
        'Estonia': 'EE',
        'Latvia': 'LV',
        'Lithuania': 'LT',
        'Luxembourg': 'LU',
        'Malta': 'MT',
        'Cyprus': 'CY'
    };
    
    // If already a 2-letter code, return as-is (uppercase)
    if (countryName.length === 2) {
        return countryName.toUpperCase();
    }
    
    // Try to find in map (case-insensitive)
    const normalized = countryName.trim();
    for (const [key, code] of Object.entries(countryMap)) {
        if (key.toLowerCase() === normalized.toLowerCase()) {
            return code;
        }
    }
    
    // Default to GB if not found
    return 'GB';
}

/**
 * Validate and normalize parent_id for Tapfiliate MLM parent endpoint
 * Returns null if invalid, otherwise returns the validated numeric string
 */
function validateParentId(rawParentId) {
    if (!rawParentId) {
        return null;
    }
    
    // Convert to string and trim
    const parentId = typeof rawParentId === 'string' ? rawParentId.trim() : String(rawParentId || '').trim();
    
    // Check if empty or the string "null"
    if (parentId === '' || parentId === 'null') {
        return null;
    }
    
    // Must be a numeric string (digits only)
    if (!/^[0-9]+$/.test(parentId)) {
        return null;
    }
    
    return parentId;
}

const COMPANY_TYPE_LABELS = {
    'supply': 'I want to store bags (Supply)',
    'vacation-rental': 'Vacation Rental / Airbnb Host',
    'pms': 'PMS',
    'venue': 'Venue',
    'blog': 'Blog',
    'tour-operator': 'Tour Operator',
    'transportations': 'Transportations',
    'other': 'Other'
};

const VALID_COMMISSION_TYPES = [
    'I want 10% commission',
    'I want 10% discount code',
    'Custom'
];

function resolveProgramId(affiliateData) {
    return PROGRAM_ID_MAP[affiliateData.program_currency] ||
        PROGRAM_ID_MAP[affiliateData.program] ||
        affiliateData.program ||
        null;
}

function buildCustomFieldsFromAffiliateData(affiliateData, fieldKeyMap) {
    const customFields = {};
    if (!fieldKeyMap) {
        return customFields;
    }

    if (affiliateData.company_type) {
        const companyTypeKey = fieldKeyMap[normalizeFieldLabel('Company type')];
        if (companyTypeKey) {
            customFields[companyTypeKey] = COMPANY_TYPE_LABELS[affiliateData.company_type] || affiliateData.company_type;
        }
    }

    if (affiliateData.commission_type) {
        const commissionKey = fieldKeyMap[normalizeFieldLabel('Commission type')];
        if (commissionKey) {
            const commissionTypeValue = VALID_COMMISSION_TYPES.includes(affiliateData.commission_type)
                ? affiliateData.commission_type
                : VALID_COMMISSION_TYPES[0];
            customFields[commissionKey] = commissionTypeValue;
        }
    }

    if (affiliateData.wantsDemoCall !== undefined && affiliateData.wantsDemoCall !== null) {
        const demoCallKey = fieldKeyMap[normalizeFieldLabel('Free DEMO call?')] ||
            fieldKeyMap[normalizeFieldLabel('Do you want a FREE DEMO call?')];
        if (demoCallKey) {
            customFields[demoCallKey] = affiliateData.wantsDemoCall ? 'Yes' : 'No';
        }
    }

    return customFields;
}

async function enrollAffiliateInProgram(affiliateId, programId, apiKey, logPrefix) {
    const enrollmentPayload = { affiliate: { id: affiliateId }, approved: null };
    const endpoint = `${TAPFILIATE_BASE_URL}programs/${programId}/affiliates/?send_welcome_email=false`;
    console.log(`${logPrefix} Enrollment endpoint:`, endpoint);

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify(enrollmentPayload)
    });

    console.log(`${logPrefix} Enrollment response status:`, response.status);

    if (!response.ok) {
        const contentType = response.headers.get('content-type');
        const errorText = await response.text();
        const trimmedError = errorText.length > 1000 ? errorText.substring(0, 1000) + '...' : errorText;
        console.error(`${logPrefix} Failed to enroll affiliate in program (trimmed):`, trimmedError);

        if (contentType && contentType.includes('text/html')) {
            return {
                ok: false,
                statusCode: 500,
                body: {
                    error: 'Something went wrong while creating your affiliate account. Please try again later.',
                    status: response.status
                }
            };
        }

        return {
            ok: false,
            statusCode: response.status || 500,
            body: {
                error: 'Affiliate created but failed to enroll in program.',
                status: response.status
            }
        };
    }

    let programResult;
    try {
        programResult = await response.json();
    } catch (parseError) {
        console.error(`${logPrefix} Could not parse enrollment response:`, parseError);
        return {
            ok: false,
            statusCode: 500,
            body: { error: 'Invalid enrollment response from Tapfiliate API' }
        };
    }

    return { ok: true, programResult };
}

async function setAffiliateWebsiteMeta(affiliateId, website, apiKey, logPrefix) {
    if (!website) {
        return;
    }

    try {
        const response = await fetch(`${TAPFILIATE_BASE_URL}affiliates/${affiliateId}/meta-data/website/`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
            body: JSON.stringify({ value: website })
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`${logPrefix} Failed to set website meta data:`, errorText.substring(0, 1000));
        } else {
            console.log(`${logPrefix} Website meta data set`);
        }
    } catch (error) {
        console.error(`${logPrefix} Error setting website meta data:`, error);
    }
}

async function setAffiliateParent(affiliateId, parentId, apiKey, logPrefix) {
    if (!parentId) {
        return;
    }

    try {
        console.log(`${logPrefix} Setting parent via Tapfiliate MLM endpoint:`, parentId);
        const response = await fetch(`${TAPFILIATE_BASE_URL}affiliates/${affiliateId}/parent/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
            body: JSON.stringify({ via: parentId })
        });

        if (!response.ok) {
            const errorText = await response.text();
            const trimmedError = errorText.length > 1000 ? errorText.substring(0, 1000) + '...' : errorText;
            console.error(`${logPrefix} Failed to set parent:`, response.status, trimmedError);
        } else {
            console.log(`${logPrefix} Parent affiliate set successfully`);
        }
    } catch (error) {
        console.error(`${logPrefix} Failed to set parent:`, error);
    }
}

async function findAffiliateIdByEmail(email, apiKey, logPrefix) {
    const lookupUrl = `${TAPFILIATE_BASE_URL}affiliates/?email=${encodeURIComponent(email)}`;
    console.log(`${logPrefix} Looking up affiliate by email:`, email);

    const response = await fetch(lookupUrl, {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`${logPrefix} Affiliate lookup failed:`, response.status, errorText.substring(0, 500));
        return null;
    }

    const affiliates = await response.json();
    if (!Array.isArray(affiliates) || affiliates.length === 0) {
        console.warn(`${logPrefix} No affiliate found for email:`, email);
        return null;
    }

    const match = affiliates.find((a) => (a.email || '').toLowerCase() === email.toLowerCase()) || affiliates[0];
    console.log(`${logPrefix} Found affiliate id:`, match.id);
    return match.id;
}

// Centralized function to build Tapfiliate affiliate payload
function buildTapfiliatePayload(affiliateData) {
    const countryCode = getCountryISOCode(affiliateData.country);
    
    // Build address object with required structure
    const address = {
        address: 'n/a',
        postal_code: 'n/a',
        city: affiliateData.city || 'n/a',
        country: {
            code: countryCode
        }
    };
    
    // Build company object
    const company = {
        name: affiliateData.company || 'n/a'
    };
    
    // Handle company_description based on company_type
    // - For vacation-rental (STR): Always send "STR"
    // - For other types (pms, venue, blog, tour-operator, transportations, other): Send provided description
    // - For supply: Don't send description
    let companyDescription = null;
    if (affiliateData.company_type === 'vacation-rental') {
        companyDescription = 'STR';
    } else if (affiliateData.company_type && 
               ['pms', 'venue', 'blog', 'tour-operator', 'transportations', 'other'].includes(affiliateData.company_type)) {
        // Use provided company_description if available
        companyDescription = affiliateData.company_description || null;
    }
    // For 'supply' or no company_type, companyDescription remains null
    
    // Build the payload according to Tapfiliate API spec
    const payload = {
        firstname: affiliateData.first_name,
        lastname: affiliateData.last_name,
        email: affiliateData.email,
        password: affiliateData.password,
        address: address,
        company: company
    };

    // DO NOT send parent_id in creation payload - use dedicated /parent/ endpoint after creation
    
    // Add company_description if determined above
    if (companyDescription) {
        payload.company_description = companyDescription;
    }
    
    // Note: website is NOT sent in custom_fields here
    // It will be set via meta-data endpoint after affiliate creation
    
    // Remove any undefined/null/empty values
    Object.keys(payload).forEach((key) => {
        const value = payload[key];
        if (value === undefined || value === null || value === '') {
            delete payload[key];
        }
    });
    
    return payload;
}

// AWS Lambda handler function
exports.handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    try {
        // Get API key from environment variable
        // In AWS Amplify, set this in the Lambda function's environment variables
        // Go to AWS Lambda Console → Your function → Configuration → Environment variables
        const TAPFILIATE_API_KEY = process.env.TAPFILIATE_API_KEY;
        
        // Check if API key is set (MANDATORY - no hardcoded fallback for security)
        if (!TAPFILIATE_API_KEY) {
            console.error('TAPFILIATE_API_KEY is not set!');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                    error: 'Server configuration error: API key not set.' 
                })
            };
        }

        // Parse request body (AWS Lambda event.body is a string)
        const affiliateData = JSON.parse(event.body);
        console.log('Received affiliate data:', JSON.stringify(affiliateData, null, 2));

        const mode = affiliateData.mode || null;

        /**
         * MODE A: Create affiliate only (after Page 3)
         * -------------------------------------------
         * Expects: first_name, last_name, email, password
         * Does:   creates affiliate in Tapfiliate and returns affiliate_id
         * Does NOT: enroll in program
         */
        if (mode === 'create_affiliate_only') {
            // Validate minimal required fields
            const requiredFieldsStageA = ['first_name', 'last_name', 'email', 'password'];
            const missingStageA = requiredFieldsStageA.filter((field) => {
                const value = affiliateData[field];
                return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
            });

            if (missingStageA.length > 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: `Missing required fields: ${missingStageA.join(', ')}`
                    })
                };
            }

            // Build Tapfiliate payload with minimal data
            const tapfiliatePayloadStageA = buildTapfiliatePayload(affiliateData);

            const fieldKeyMap = await getCustomFieldKeys(TAPFILIATE_API_KEY);
            const customFields = buildCustomFieldsFromAffiliateData(affiliateData, fieldKeyMap);
            if (Object.keys(customFields).length > 0) {
                tapfiliatePayloadStageA.custom_fields = customFields;
                console.log('[Stage A] Final custom_fields payload:', JSON.stringify(customFields, null, 2));
            }

            // parent_id now sent in creation payload; keep /parent call as fallback
            if (affiliateData.parent_id && affiliateData.parent_id !== '' && affiliateData.parent_id !== 'null') {
                console.log('[Stage A] 🔗 Sending parent_id in creation payload:', affiliateData.parent_id);
            } else {
                console.log('[Stage A] 👤 Creating top-level affiliate (no parent)');
            }

            // Log the payload (mask sensitive data)
            const logPayloadStageA = { ...tapfiliatePayloadStageA };
            if (logPayloadStageA.password) {
                logPayloadStageA.password = '***MASKED***';
            }
            console.log('[Stage A] Tapfiliate payload (password masked):', JSON.stringify(logPayloadStageA, null, 2));

            console.log('[Stage A] Creating affiliate in Tapfiliate...');
            console.log('[Stage A] API Endpoint:', `${TAPFILIATE_BASE_URL}affiliates/`);

            const createResponseStageA = await fetch(`${TAPFILIATE_BASE_URL}affiliates/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': TAPFILIATE_API_KEY
                },
                body: JSON.stringify(tapfiliatePayloadStageA)
            });

            console.log('[Stage A] Tapfiliate response status:', createResponseStageA.status);

            if (!createResponseStageA.ok) {
                const contentType = createResponseStageA.headers.get('content-type');
                const errorText = await createResponseStageA.text();

                const trimmedError = errorText.length > 1000 ? errorText.substring(0, 1000) + '...' : errorText;
                console.error('[Stage A] Tapfiliate API error response (trimmed):', trimmedError);

                // Check if response is HTML (error page)
                if (contentType && contentType.includes('text/html')) {
                    console.error('[Stage A] Tapfiliate returned HTML error page instead of JSON');
                    return {
                        statusCode: 500,
                        headers,
                        body: JSON.stringify({
                            error: 'Something went wrong while creating your affiliate account. Please try again later.',
                            status: createResponseStageA.status
                        })
                    };
                }

                let errorMessage = 'Failed to create affiliate';

                try {
                    const errorJson = JSON.parse(errorText);
                    if (errorJson.errors && Array.isArray(errorJson.errors)) {
                        errorMessage = errorJson.errors.map(e => e.message || e).join(', ');
                    } else if (errorJson.message) {
                        errorMessage = errorJson.message;
                    }
                } catch (e) {
                    errorMessage = 'Something went wrong while creating your affiliate account. Please try again later.';
                }

                return {
                    statusCode: createResponseStageA.status,
                    headers,
                    body: JSON.stringify({
                        error: errorMessage,
                        status: createResponseStageA.status
                    })
                };
            }

            const affiliateStageA = await createResponseStageA.json();

            if (!affiliateStageA || !affiliateStageA.id) {
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({
                        error: 'Invalid response from Tapfiliate API'
                    })
                };
            }

            console.log('[Stage A] Affiliate created with ID:', affiliateStageA.id);

            // Set parent affiliate if provided (for MLM functionality)
            const parentIdStageA = validateParentId(affiliateData.parent_id);
            if (parentIdStageA) {
                try {
                    console.log('[Parent] Setting parent via Tapfiliate MLM endpoint:', parentIdStageA);
                    const setParentResponse = await fetch(
                        `${TAPFILIATE_BASE_URL}affiliates/${affiliateStageA.id}/parent/`,
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Api-Key': TAPFILIATE_API_KEY
                            },
                            body: JSON.stringify({
                                via: parentIdStageA
                            })
                        }
                    );

                    if (!setParentResponse.ok) {
                        const parentErrorText = await setParentResponse.text();
                        const trimmedParentError = parentErrorText.length > 1000 ? parentErrorText.substring(0, 1000) + '...' : parentErrorText;
                        console.error('[Parent] Failed to set parent:', setParentResponse.status, trimmedParentError);
                        // Continue anyway - affiliate was created successfully
                    } else {
                        console.log('[Stage A] ✅ Parent affiliate set successfully');
                    }
                } catch (parentError) {
                    console.error('[Parent] Failed to set parent:', parentError);
                    // Continue anyway - affiliate was created successfully
                }
            } else if (affiliateData.parent_id) {
                console.log('[Parent] Skipping parent set – invalid parent_id value:', affiliateData.parent_id);
            }

            // Return only affiliate_id (no program enrollment here)
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    mode: 'create_affiliate_only',
                    affiliate_id: affiliateStageA.id
                })
            };
        }

        /**
         * MODE B: Finalize affiliate (after last page)
         * --------------------------------------------
         * Expects: affiliate_id, program, optional metadata (website), optional address, optional company
         * Does:   updates affiliate with complete info, enrolls existing affiliate into program, sets website meta-data
         */
        if (mode === 'finalize_affiliate') {
            const { affiliate_id, program, metadata, email } = affiliateData;
            let affiliateIdFinalize = affiliate_id;

            if (!affiliateIdFinalize && email) {
                affiliateIdFinalize = await findAffiliateIdByEmail(email, TAPFILIATE_API_KEY, '[Stage B]');
            }

            if (!affiliateIdFinalize) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Missing affiliate_id or email for finalize_affiliate mode'
                    })
                };
            }

            const mappedProgramIdFinalize = resolveProgramId(affiliateData);
            console.log('[Stage B] Program enrollment target:', mappedProgramIdFinalize, '(currency:', affiliateData.program_currency || 'n/a', ', program field:', program || 'n/a', ')');
            if (!mappedProgramIdFinalize) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Missing or invalid program selection'
                    })
                };
            }

            // Enrollment only — affiliate data is set at create time (Tapfiliate has no update endpoint).
            const enrollmentResult = await enrollAffiliateInProgram(
                affiliateIdFinalize,
                mappedProgramIdFinalize,
                TAPFILIATE_API_KEY,
                '[Stage B]'
            );

            if (!enrollmentResult.ok) {
                return {
                    statusCode: enrollmentResult.statusCode,
                    headers,
                    body: JSON.stringify(enrollmentResult.body)
                };
            }

            await setAffiliateWebsiteMeta(
                affiliateIdFinalize,
                metadata && metadata.website,
                TAPFILIATE_API_KEY,
                '[Stage B]'
            );

            const parentIdFinalize = validateParentId(affiliateData.parent_id);
            if (parentIdFinalize) {
                await setAffiliateParent(affiliateIdFinalize, parentIdFinalize, TAPFILIATE_API_KEY, '[Stage B]');
            } else if (affiliateData.parent_id) {
                console.log('[Parent] Skipping parent set – invalid parent_id value:', affiliateData.parent_id);
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    mode: 'finalize_affiliate',
                    affiliate_id: affiliateIdFinalize,
                    program: enrollmentResult.programResult
                })
            };
        }

        /**
         * MODE B2: Complete enrollment by email (recovery when create succeeded but client got 502)
         * ---------------------------------------------------------------------------------------
         * Expects: email, program or program_currency
         * Does:    looks up affiliate by email, enrolls into program as pending
         */
        if (mode === 'complete_enrollment') {
            const { email, metadata } = affiliateData;

            if (!email) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Missing email for complete_enrollment mode' })
                };
            }

            const mappedProgramIdComplete = resolveProgramId(affiliateData);
            if (!mappedProgramIdComplete) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Missing or invalid program selection' })
                };
            }

            const affiliateIdComplete = await findAffiliateIdByEmail(email, TAPFILIATE_API_KEY, '[Complete]');
            if (!affiliateIdComplete) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'No affiliate found for this email.' })
                };
            }

            const enrollmentResultComplete = await enrollAffiliateInProgram(
                affiliateIdComplete,
                mappedProgramIdComplete,
                TAPFILIATE_API_KEY,
                '[Complete]'
            );

            if (!enrollmentResultComplete.ok) {
                return {
                    statusCode: enrollmentResultComplete.statusCode,
                    headers,
                    body: JSON.stringify(enrollmentResultComplete.body)
                };
            }

            await setAffiliateWebsiteMeta(
                affiliateIdComplete,
                metadata && metadata.website,
                TAPFILIATE_API_KEY,
                '[Complete]'
            );

            const parentIdComplete = validateParentId(affiliateData.parent_id);
            if (parentIdComplete) {
                await setAffiliateParent(affiliateIdComplete, parentIdComplete, TAPFILIATE_API_KEY, '[Complete]');
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    mode: 'complete_enrollment',
                    affiliate_id: affiliateIdComplete,
                    program: enrollmentResultComplete.programResult
                })
            };
        }

        /**
         * MODE C: Update custom fields only (after Page 4)
         * ------------------------------------------------
         * Expects: affiliate_id, commission_type (optional)
         * Does:   updates only custom fields for existing affiliate
         */
        if (mode === 'update_custom_fields') {
            const { affiliate_id, commission_type } = affiliateData;

            if (!affiliate_id) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Missing affiliate_id for update_custom_fields mode'
                    })
                };
            }

            // Fetch custom field keys and build custom fields
            const fieldKeyMap = await getCustomFieldKeys(TAPFILIATE_API_KEY);
            const customFields = {};
            
            console.log('[Stage C] 🔍 DEBUG: Commission type received:', commission_type);
            console.log('[Stage C] 🔍 DEBUG: Affiliate ID:', affiliate_id);
            
            if (fieldKeyMap) {
                // DEBUG: Log all available custom fields
                console.log('[Stage C] 🔍 DEBUG: All available custom fields in Tapfiliate:');
                Object.keys(fieldKeyMap).forEach(fieldName => {
                    console.log(`[Stage C]   - "${fieldName}" -> ID: ${fieldKeyMap[fieldName]}`);
                });
                
                // Add Commission type if provided
                if (commission_type) {
                    const commissionKey = fieldKeyMap[normalizeFieldLabel('Commission type')];
                    console.log('[Stage C] 🔍 DEBUG: Looking for field "Commission type"');
                    console.log('[Stage C] 🔍 DEBUG: Field key found:', commissionKey ? `YES (ID: ${commissionKey})` : 'NO - FIELD NOT FOUND!');
                    
                    if (commissionKey) {
                        // Validate and normalize commission type to ensure only one of the three formats is sent
                        const validCommissionTypes = [
                            'I want 10% commission',
                            'I want 10% discount code',
                            'Custom'
                        ];
                        const commissionTypeValue = validCommissionTypes.includes(commission_type) 
                            ? commission_type 
                            : validCommissionTypes[0];
                        
                        console.log('[Stage C] ✅ DEBUG: Setting commission type value:', commissionTypeValue);
                        customFields[commissionKey] = commissionTypeValue;
                    } else {
                        console.error('[Stage C] ❌ DEBUG: Commission type field "Commission type" NOT FOUND in Tapfiliate!');
                        console.error('[Stage C] ❌ DEBUG: Available field names:', Object.keys(fieldKeyMap));
                        console.error('[Stage C] ❌ DEBUG: Check if field name matches exactly (case-sensitive, spacing, etc.)');
                    }
                } else {
                    console.log('[Stage C] ⚠️ DEBUG: No commission_type value provided');
                }
            } else {
                console.error('[Stage C] ❌ DEBUG: fieldKeyMap is null - cannot fetch custom fields');
            }
            
            // Only update if we have custom fields to update
            console.log('[Stage C] 🔍 DEBUG: Custom fields to send:', Object.keys(customFields).length > 0 ? customFields : 'NONE');
            
            if (Object.keys(customFields).length > 0) {
                const updatePayload = {
                    custom_fields: customFields
                };

                console.log('[Stage C] 📤 DEBUG: Sending update payload to Tapfiliate:');
                console.log('[Stage C] 📤 DEBUG: Endpoint:', `${TAPFILIATE_BASE_URL}affiliates/${affiliate_id}/`);
                console.log('[Stage C] 📤 DEBUG: Payload:', JSON.stringify(updatePayload, null, 2));

                try {
                    console.log('[Stage C] Updating affiliate custom fields...');
                    const updateResponse = await fetch(`${TAPFILIATE_BASE_URL}affiliates/${affiliate_id}/`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': TAPFILIATE_API_KEY
                        },
                        body: JSON.stringify(updatePayload)
                    });

                    const responseText = await updateResponse.text();
                    console.log('[Stage C] 📥 DEBUG: Tapfiliate response status:', updateResponse.status);
                    console.log('[Stage C] 📥 DEBUG: Tapfiliate response body:', responseText);

                    if (!updateResponse.ok) {
                        const trimmedError = responseText.length > 1000 ? responseText.substring(0, 1000) + '...' : responseText;
                        console.error('[Stage C] ⚠️ Failed to update custom fields (trimmed):', trimmedError);
                        return {
                            statusCode: updateResponse.status,
                            headers,
                            body: JSON.stringify({
                                error: 'Failed to update commission type',
                                status: updateResponse.status
                            })
                        };
                    } else {
                        console.log('[Stage C] ✅ Custom fields updated successfully');
                        console.log('[Stage C] ✅ DEBUG: Full response:', responseText);
                        return {
                            statusCode: 200,
                            headers,
                            body: JSON.stringify({
                                success: true,
                                mode: 'update_custom_fields',
                                affiliate_id
                            })
                        };
                    }
                } catch (updateError) {
                    console.error('[Stage C] ❌ DEBUG: Error updating custom fields:', updateError);
                    console.error('[Stage C] ❌ DEBUG: Error stack:', updateError.stack);
                    return {
                        statusCode: 500,
                        headers,
                        body: JSON.stringify({
                            error: 'Internal server error while updating custom fields',
                            message: updateError.message
                        })
                    };
                }
            } else {
                // No custom fields to update
                console.warn('[Stage C] ⚠️ DEBUG: No custom fields to update - empty customFields object');
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        success: true,
                        mode: 'update_custom_fields',
                        affiliate_id,
                        message: 'No custom fields to update'
                    })
                };
            }
        }

        /**
         * MODE D: signup_and_enroll OR legacy default (no mode)
         * ---------------------------------------------------
         * Creates affiliate and enrolls in program in one Lambda invocation.
         * Keeps affiliates out of Archived by ensuring enrollment always runs.
         */
        if (mode === 'signup_and_enroll' || !mode) {
            if (mode === 'signup_and_enroll') {
                console.log('[Signup] signup_and_enroll mode — create + enroll in one call');
            } else {
                console.log('[Legacy] Default mode — create + enroll in one call');
            }

            const mappedProgramId = resolveProgramId(affiliateData);
            console.log('Program enrollment target:', mappedProgramId, '(currency:', affiliateData.program_currency || 'n/a', ', program field:', affiliateData.program || 'n/a', ')');
            if (!mappedProgramId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Missing or invalid program selection'
                    })
                };
            }

            const requiredFields = ['first_name', 'last_name', 'email', 'password', 'city', 'country', 'company'];
            const missing = requiredFields.filter((field) => {
                const value = affiliateData[field];
                return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
            });

            if (missing.length > 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: `Missing required fields: ${missing.join(', ')}`
                    })
                };
            }

            const tapfiliatePayload = buildTapfiliatePayload(affiliateData);

            const fieldKeyMap = await getCustomFieldKeys(TAPFILIATE_API_KEY);
            const customFields = buildCustomFieldsFromAffiliateData(affiliateData, fieldKeyMap);
            if (Object.keys(customFields).length > 0) {
                tapfiliatePayload.custom_fields = customFields;
                console.log('Final custom_fields payload:', JSON.stringify(customFields, null, 2));
            }

        // Note: parent_id cannot be set during creation - must use separate API call after creation
        if (affiliateData.parent_id && affiliateData.parent_id !== '' && affiliateData.parent_id !== 'null') {
            console.log('🔗 Will set parent after affiliate creation:', affiliateData.parent_id);
        } else {
            console.log('👤 Creating top-level affiliate (no parent)');
        }

        // Log the payload (mask sensitive data)
        const logPayload = { ...tapfiliatePayload };
        if (logPayload.password) {
            logPayload.password = '***MASKED***';
        }
        console.log('Tapfiliate payload (password masked):', JSON.stringify(logPayload, null, 2));
        console.log('Program ID (for enrollment):', mappedProgramId);

        // Step 1: Create affiliate in Tapfiliate
        console.log('Creating affiliate in Tapfiliate...');
        console.log('API Endpoint:', `${TAPFILIATE_BASE_URL}affiliates/`);
        console.log('API Key present:', !!TAPFILIATE_API_KEY);
        
        const createResponse = await fetch(`${TAPFILIATE_BASE_URL}affiliates/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': TAPFILIATE_API_KEY
            },
            body: JSON.stringify(tapfiliatePayload)
        });
        
        console.log('Tapfiliate response status:', createResponse.status);

        if (!createResponse.ok) {
            const contentType = createResponse.headers.get('content-type');
            const errorText = await createResponse.text();
            
            // Log error details (trim long responses)
            const trimmedError = errorText.length > 1000 ? errorText.substring(0, 1000) + '...' : errorText;
            console.error('Tapfiliate API error response (trimmed):', trimmedError);
            console.error('Response status:', createResponse.status);
            console.error('Response content-type:', contentType);
            
            // Check if response is HTML (error page)
            if (contentType && contentType.includes('text/html')) {
                console.error('Tapfiliate returned HTML error page instead of JSON');
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ 
                        error: 'Something went wrong while creating your affiliate account. Please try again later.',
                        status: createResponse.status
                    })
                };
            }
            
            let errorMessage = 'Failed to create affiliate';
            
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.errors && Array.isArray(errorJson.errors)) {
                    errorMessage = errorJson.errors.map(e => e.message || e).join(', ');
                } else if (errorJson.message) {
                    errorMessage = errorJson.message;
                }
            } catch (e) {
                // If not JSON, it might be HTML or plain text
                errorMessage = 'Something went wrong while creating your affiliate account. Please try again later.';
            }

            return {
                statusCode: createResponse.status,
                headers,
                body: JSON.stringify({ 
                    error: errorMessage,
                    status: createResponse.status
                })
            };
        }

        const affiliate = await createResponse.json();

        if (!affiliate || !affiliate.id) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                    error: 'Invalid response from Tapfiliate API' 
                })
            };
        }

        // Step 2: Enroll in program (must succeed or affiliate stays archived)
        const enrollmentResult = await enrollAffiliateInProgram(
            affiliate.id,
            mappedProgramId,
            TAPFILIATE_API_KEY,
            '[Legacy]'
        );

        if (!enrollmentResult.ok) {
            return {
                statusCode: enrollmentResult.statusCode,
                headers,
                body: JSON.stringify(enrollmentResult.body)
            };
        }

        await setAffiliateWebsiteMeta(
            affiliate.id,
            affiliateData.metadata && affiliateData.metadata.website,
            TAPFILIATE_API_KEY,
            '[Legacy]'
        );

        const parentId = validateParentId(affiliateData.parent_id);
        if (parentId) {
            await setAffiliateParent(affiliate.id, parentId, TAPFILIATE_API_KEY, '[Legacy]');
        } else if (affiliateData.parent_id) {
            console.log('[Parent] Skipping parent set – invalid parent_id value:', affiliateData.parent_id);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                mode: mode || 'legacy',
                affiliate: affiliate,
                program: enrollmentResult.programResult
            })
        };
        }

        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
                error: `Unknown mode: ${mode}`
            })
        };

    } catch (error) {
        console.error('Lambda function error:', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                error: 'Internal server error',
                message: error.message
            })
        };
    }
};


