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

            // Fetch custom field keys and add custom fields if provided
            const fieldKeyMap = await getCustomFieldKeys(TAPFILIATE_API_KEY);
            if (fieldKeyMap) {
                const customFields = {};
                
                // Add Company type if provided
                if (affiliateData.company_type) {
                    const companyTypeKey = fieldKeyMap[normalizeFieldLabel('Company type')];
                    if (companyTypeKey) {
                        // Map company type values to labels
                        const companyTypeLabels = {
                            'supply': 'I want to store bags (Supply)',
                            'vacation-rental': 'Vacation Rental / Airbnb Host',
                            'pms': 'PMS',
                            'venue': 'Venue',
                            'blog': 'Blog',
                            'tour-operator': 'Tour Operator',
                            'transportations': 'Transportations',
                            'other': 'Other'
                        };
                        const companyTypeValue = companyTypeLabels[affiliateData.company_type] || affiliateData.company_type;
                        customFields[companyTypeKey] = companyTypeValue;
                    }
                }
                
                // Add Commission type if provided (same pattern as company type)
                if (affiliateData.commission_type) {
                    const commissionKey = fieldKeyMap[normalizeFieldLabel('Commission type')];
                    if (commissionKey) {
                        // Validate and normalize commission type to ensure only one of the three formats is sent
                        const validCommissionTypes = [
                            'I want 10% commission',
                            'I want 10% discount code',
                            'Custom'
                        ];
                        // Use value directly if it's one of the valid formats, otherwise default to the first valid value
                        const commissionTypeValue = validCommissionTypes.includes(affiliateData.commission_type) 
                            ? affiliateData.commission_type 
                            : validCommissionTypes[0];
                        customFields[commissionKey] = commissionTypeValue;
                    }
                }
                
                // Add Free DEMO call if provided (same pattern as company type)
                if (affiliateData.wantsDemoCall !== undefined && affiliateData.wantsDemoCall !== null) {
                    const demoCallKey = fieldKeyMap[normalizeFieldLabel('Free DEMO call?')] || fieldKeyMap[normalizeFieldLabel('Do you want a FREE DEMO call?')];
                    if (demoCallKey) {
                        customFields[demoCallKey] = affiliateData.wantsDemoCall ? 'Yes' : 'No';
                    }
                }
                
                if (Object.keys(customFields).length > 0) {
                    tapfiliatePayloadStageA.custom_fields = customFields;
                    console.log('[Stage A] Final custom_fields payload:', JSON.stringify(customFields, null, 2));
                }
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
            const { affiliate_id, program, metadata, address, company, company_type, company_description } = affiliateData;

            if (!affiliate_id) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Missing affiliate_id for finalize_affiliate mode'
                    })
                };
            }

            const mappedProgramIdFinalize = PROGRAM_ID_MAP[program] || program;
            if (!mappedProgramIdFinalize) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Missing or invalid program selection'
                    })
                };
            }

            // Fetch custom field keys and build custom fields (same pattern as company type)
            const fieldKeyMap = await getCustomFieldKeys(TAPFILIATE_API_KEY);
            const customFields = {};
            
            if (fieldKeyMap) {
                // Add Commission type if provided (same pattern as company type)
                if (affiliateData.commission_type) {
                    const commissionKey = fieldKeyMap[normalizeFieldLabel('Commission type')];
                    if (commissionKey) {
                        // Validate and normalize commission type to ensure only one of the three formats is sent
                        const validCommissionTypes = [
                            'I want 10% commission',
                            'I want 10% discount code',
                            'Custom'
                        ];
                        // Use value directly if it's one of the valid formats, otherwise default to the first valid value
                        const commissionTypeValue = validCommissionTypes.includes(affiliateData.commission_type) 
                            ? affiliateData.commission_type 
                            : validCommissionTypes[0];
                        customFields[commissionKey] = commissionTypeValue;
                    }
                }
                
                // Add Free DEMO call if provided (same pattern as company type)
                if (affiliateData.wantsDemoCall !== undefined && affiliateData.wantsDemoCall !== null) {
                    const demoCallKey = fieldKeyMap[normalizeFieldLabel('Free DEMO call?')] || fieldKeyMap[normalizeFieldLabel('Do you want a FREE DEMO call?')];
                    if (demoCallKey) {
                        customFields[demoCallKey] = affiliateData.wantsDemoCall ? 'Yes' : 'No';
                    }
                }
            }
            
            // Handle company_description based on company_type (same logic as buildTapfiliatePayload)
            let companyDescriptionToAdd = null;
            if (company_type === 'vacation-rental') {
                companyDescriptionToAdd = 'STR';
            } else if (company_type && 
                       ['pms', 'venue', 'blog', 'tour-operator', 'transportations', 'other'].includes(company_type)) {
                // Use provided company_description if available
                companyDescriptionToAdd = company_description || null;
            }
            // For 'supply' or no company_type, companyDescriptionToAdd remains null
            
            // Update affiliate with complete information if provided
            const updatePayload = {};
            // DO NOT include parent_id in update payload - use dedicated /parent/ endpoint instead
            if (address) {
                updatePayload.address = address;
            }
            if (company) {
                // Create a copy of company object and add description if needed
                const companyToUpdate = { ...company };
                if (companyDescriptionToAdd) {
                    companyToUpdate.description = companyDescriptionToAdd;
                }
                updatePayload.company = companyToUpdate;
            } else if (companyDescriptionToAdd) {
                // If no company object but we have description, create one
                updatePayload.company = {
                    name: 'n/a',
                    description: companyDescriptionToAdd
                };
            }
            if (Object.keys(customFields).length > 0) {
                updatePayload.custom_fields = customFields;
                console.log('[Stage B] Final custom_fields payload:', JSON.stringify(customFields, null, 2));
            }

            // Run update, meta-data, and enrollment in parallel — they are independent
            console.log('[Stage B] Running update, meta-data, and enrollment in parallel...');

            const updatePromise = Object.keys(updatePayload).length > 0
                ? fetch(`${TAPFILIATE_BASE_URL}affiliates/${affiliate_id}/`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'X-Api-Key': TAPFILIATE_API_KEY },
                    body: JSON.stringify(updatePayload)
                }).then(async r => {
                    if (!r.ok) console.error('[Stage B] ⚠️ Failed to update affiliate:', await r.text());
                    else console.log('[Stage B] ✅ Affiliate updated with complete info');
                }).catch(e => console.error('[Stage B] Error updating affiliate:', e))
                : Promise.resolve();

            const metaPromise = (metadata && metadata.website)
                ? fetch(`${TAPFILIATE_BASE_URL}affiliates/${affiliate_id}/meta-data/website/`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-Api-Key': TAPFILIATE_API_KEY },
                    body: JSON.stringify({ value: metadata.website })
                }).then(async r => {
                    if (!r.ok) {
                        const t = await r.text();
                        console.error('[Stage B] Failed to set website meta data:', t.substring(0, 1000));
                    } else {
                        console.log('[Stage B] ✅ Website meta data set');
                    }
                }).catch(e => console.error('[Stage B] Error setting website meta data:', e))
                : Promise.resolve();

            const enrollmentPayloadFinalize = { affiliate: { id: affiliate_id }, approved: null };
            console.log('[Stage B] Enrollment endpoint:', `${TAPFILIATE_BASE_URL}programs/${mappedProgramIdFinalize}/affiliates/?send_welcome_email=false`);

            const addToProgramResponseFinalize = fetch(
                `${TAPFILIATE_BASE_URL}programs/${mappedProgramIdFinalize}/affiliates/?send_welcome_email=false`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Api-Key': TAPFILIATE_API_KEY },
                    body: JSON.stringify(enrollmentPayloadFinalize)
                }
            );

            const [, , addToProgramResponseFinalizeResolved] = await Promise.all([updatePromise, metaPromise, addToProgramResponseFinalize]);

            console.log('[Stage B] Enrollment response status:', addToProgramResponseFinalizeResolved.status);

            if (!addToProgramResponseFinalizeResolved.ok) {
                const contentTypeFinalize = addToProgramResponseFinalizeResolved.headers.get('content-type');
                const errorTextFinalize = await addToProgramResponseFinalizeResolved.text();

                const trimmedErrorFinalize = errorTextFinalize.length > 1000 ? errorTextFinalize.substring(0, 1000) + '...' : errorTextFinalize;
                console.error('[Stage B] Failed to enroll affiliate in program (trimmed):', trimmedErrorFinalize);

                if (contentTypeFinalize && contentTypeFinalize.includes('text/html')) {
                    console.error('[Stage B] Tapfiliate returned HTML error page instead of JSON');
                    return {
                        statusCode: 500,
                        headers,
                        body: JSON.stringify({
                            error: 'Something went wrong while creating your affiliate account. Please try again later.',
                            status: addToProgramResponseFinalizeResolved.status
                        })
                    };
                }

                return {
                    statusCode: addToProgramResponseFinalizeResolved.status || 500,
                    headers,
                    body: JSON.stringify({
                        error: 'Affiliate created but failed to enroll in program.',
                        status: addToProgramResponseFinalizeResolved.status
                    })
                };
            }

            const programResultFinalize = await addToProgramResponseFinalizeResolved.json();

            // Set parent affiliate AFTER successful enrollment (for MLM functionality)
            const parentIdFinalize = validateParentId(affiliateData.parent_id);
            if (parentIdFinalize) {
                try {
                    console.log('[Parent] Setting parent via Tapfiliate MLM endpoint:', parentIdFinalize);
                    const setParentResponseFinalize = await fetch(
                        `${TAPFILIATE_BASE_URL}affiliates/${affiliate_id}/parent/`,
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Api-Key': TAPFILIATE_API_KEY
                            },
                            body: JSON.stringify({
                                via: parentIdFinalize
                            })
                        }
                    );

                    if (!setParentResponseFinalize.ok) {
                        const parentErrorTextFinalize = await setParentResponseFinalize.text();
                        const trimmedParentErrorFinalize = parentErrorTextFinalize.length > 1000 ? parentErrorTextFinalize.substring(0, 1000) + '...' : parentErrorTextFinalize;
                        console.error('[Parent] Failed to set parent:', setParentResponseFinalize.status, trimmedParentErrorFinalize);
                        // Continue anyway - affiliate is enrolled successfully
                    } else {
                        console.log('[Stage B] ✅ Parent affiliate set successfully');
                    }
                } catch (parentErrorFinalize) {
                    console.error('[Parent] Failed to set parent:', parentErrorFinalize);
                    // Continue anyway - affiliate is enrolled successfully
                }
            } else if (affiliateData.parent_id) {
                console.log('[Parent] Skipping parent set – invalid parent_id value:', affiliateData.parent_id);
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    mode: 'finalize_affiliate',
                    affiliate_id,
                    program: programResultFinalize
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
         * LEGACY / DEFAULT MODE (no mode field)
         * -------------------------------------
         * Keeps existing behavior: create affiliate + enroll in program
         */
        const mappedProgramId = PROGRAM_ID_MAP[affiliateData.program] || affiliateData.program;
        if (!mappedProgramId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'Missing or invalid program selection'
                })
            };
        }

        // Validate required fields (using frontend field names)
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

        // DO NOT send onboarding_fields - Company Type, Commission Type, and Number of Properties
        // are collected in the form for validation only, but NOT sent to Tapfiliate API
        // Explicitly DO NOT include:
        // - company_type (collected in form but not sent to API)
        // - commission_type (collected in form but not sent to API)
        // - number_of_properties (collected in form but not sent to API)

        // Build Tapfiliate payload using centralized function
        const tapfiliatePayload = buildTapfiliatePayload(affiliateData);

        // Fetch custom field keys and add custom fields if provided
        const fieldKeyMap = await getCustomFieldKeys(TAPFILIATE_API_KEY);
        if (fieldKeyMap) {
            const customFields = {};
            
            // Add Company type if provided
            if (affiliateData.company_type) {
                const companyTypeKey = fieldKeyMap[normalizeFieldLabel('Company type')];
                if (companyTypeKey) {
                    // Map company type values to labels
                    const companyTypeLabels = {
                        'supply': 'I want to store bags (Supply)',
                        'vacation-rental': 'Vacation Rental / Airbnb Host',
                        'pms': 'PMS',
                        'venue': 'Venue',
                        'blog': 'Blog',
                        'tour-operator': 'Tour Operator',
                        'transportations': 'Transportations',
                        'other': 'Other'
                    };
                    const companyTypeValue = companyTypeLabels[affiliateData.company_type] || affiliateData.company_type;
                    customFields[companyTypeKey] = companyTypeValue;
                }
            }
            
            // Add Commission type if provided (same pattern as company type)
            if (affiliateData.commission_type) {
                const commissionKey = fieldKeyMap[normalizeFieldLabel('Commission type')];
                if (commissionKey) {
                    // Validate and normalize commission type to ensure only one of the three formats is sent
                    const validCommissionTypes = [
                        'I want 10% commission',
                        'I want 10% discount code',
                        'Custom'
                    ];
                    // Use value directly if it's one of the valid formats, otherwise default to the first valid value
                    const commissionTypeValue = validCommissionTypes.includes(affiliateData.commission_type) 
                        ? affiliateData.commission_type 
                        : validCommissionTypes[0];
                    customFields[commissionKey] = commissionTypeValue;
                }
            }
            
            // Add Free DEMO call if provided (same pattern as company type)
            if (affiliateData.wantsDemoCall !== undefined && affiliateData.wantsDemoCall !== null) {
                const demoCallKey = fieldKeyMap[normalizeFieldLabel('Free DEMO call?')] || fieldKeyMap[normalizeFieldLabel('Do you want a FREE DEMO call?')];
                if (demoCallKey) {
                    customFields[demoCallKey] = affiliateData.wantsDemoCall ? 'Yes' : 'No';
                }
            }
            
            if (Object.keys(customFields).length > 0) {
                tapfiliatePayload.custom_fields = customFields;
                console.log('Final custom_fields payload:', JSON.stringify(customFields, null, 2));
            }
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

        // Step 1.5 + Step 2: Set website meta-data and enroll in program in parallel
        console.log('Running meta-data and enrollment in parallel...');

        const legacyMetaPromise = (affiliateData.metadata && affiliateData.metadata.website)
            ? fetch(`${TAPFILIATE_BASE_URL}affiliates/${affiliate.id}/meta-data/website/`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': TAPFILIATE_API_KEY },
                body: JSON.stringify({ value: affiliateData.metadata.website })
            }).then(async r => {
                console.log('Website meta data response status:', r.status);
                if (!r.ok) {
                    const t = await r.text();
                    console.error('Failed to set website meta data:', t.substring(0, 1000));
                }
            }).catch(e => console.error('Error setting website meta data:', e))
            : Promise.resolve();

        const enrollmentPayload = { affiliate: { id: affiliate.id }, approved: null };
        console.log('Enrollment endpoint:', `${TAPFILIATE_BASE_URL}programs/${mappedProgramId}/affiliates/?send_welcome_email=false`);

        const legacyEnrollPromise = fetch(
            `${TAPFILIATE_BASE_URL}programs/${mappedProgramId}/affiliates/?send_welcome_email=false`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': TAPFILIATE_API_KEY },
                body: JSON.stringify(enrollmentPayload)
            }
        );

        const [, addToProgramResponse] = await Promise.all([legacyMetaPromise, legacyEnrollPromise]);

        console.log('Enrollment response status:', addToProgramResponse.status);

        if (!addToProgramResponse.ok) {
            const contentType = addToProgramResponse.headers.get('content-type');
            const errorText = await addToProgramResponse.text();
            
            // Log error details (trim long responses)
            const trimmedError = errorText.length > 1000 ? errorText.substring(0, 1000) + '...' : errorText;
            console.error('Failed to enroll affiliate in program (trimmed):', trimmedError);
            console.error('Response status:', addToProgramResponse.status);
            console.error('Response content-type:', contentType);
            
            // Check if response is HTML (error page)
            if (contentType && contentType.includes('text/html')) {
                console.error('Tapfiliate returned HTML error page instead of JSON');
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({
                        error: 'Something went wrong while creating your affiliate account. Please try again later.',
                        status: addToProgramResponse.status
                    })
                };
            }
            
            return {
                statusCode: addToProgramResponse.status || 500,
                headers,
                body: JSON.stringify({
                    error: 'Affiliate created but failed to enroll in program.',
                    status: addToProgramResponse.status
                })
            };
        }

        const programResult = await addToProgramResponse.json();

        // Set parent affiliate AFTER successful enrollment (for MLM functionality)
        const parentId = validateParentId(affiliateData.parent_id);
        if (parentId) {
            try {
                console.log('[Parent] Setting parent via Tapfiliate MLM endpoint:', parentId);
                const setParentResponse = await fetch(
                    `${TAPFILIATE_BASE_URL}affiliates/${affiliate.id}/parent/`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': TAPFILIATE_API_KEY
                        },
                        body: JSON.stringify({
                            via: parentId
                        })
                    }
                );

                if (!setParentResponse.ok) {
                    const parentErrorText = await setParentResponse.text();
                    const trimmedParentError = parentErrorText.length > 1000 ? parentErrorText.substring(0, 1000) + '...' : parentErrorText;
                    console.error('[Parent] Failed to set parent:', setParentResponse.status, trimmedParentError);
                    // Continue anyway - affiliate is enrolled successfully
                } else {
                    console.log('✅ Parent affiliate set successfully');
                }
            } catch (parentError) {
                console.error('[Parent] Failed to set parent:', parentError);
                // Continue anyway - affiliate is enrolled successfully
            }
        } else if (affiliateData.parent_id) {
            console.log('[Parent] Skipping parent set – invalid parent_id value:', affiliateData.parent_id);
        }

        // Success - affiliate created and added to program (should be in Pending status)
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                affiliate: affiliate,
                program: programResult
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


