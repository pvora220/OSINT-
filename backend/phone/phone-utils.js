const countryCodes = require('./country-codes.json');

function parsePhoneNumber(digits) {
    // Detect country by longest matching prefix (try 3, then 2, then 1 digit)
    let country = null;
    let dialLen = 0;

    for (const len of [3, 2, 1]) {
        const pfx = digits.substring(0, len);
        if (countryCodes[pfx]) {
            country = countryCodes[pfx];
            dialLen = len;
            break;
        }
    }

    const countryName = country ? country.n : 'Unknown';
    const countryCode = country ? country.c : 'N/A';
    const countryPrefix = country ? country.p : '+' + digits.substring(0, 1);
    const national = country ? digits.substring(dialLen) : digits;
    const e164 = countryPrefix + national;

    // Rough number-type detection (NANP for +1, basic patterns elsewhere)
    let numType = 'GEOGRAPHIC / MOBILE';
    if (dialLen === 1 && digits[0] === '1' && national.length >= 3) {
        const area = national.substring(0, 3);
        if (['800', '833', '844', '855', '866', '877', '888'].includes(area)) numType = 'TOLL FREE';
        else if (['900', '976'].includes(area)) numType = 'PREMIUM RATE';
    }

    // Format national number
    let localFmt = national;
    let intlFmt = e164;
    if (dialLen === 1 && digits[0] === '1' && national.length === 10) {
        localFmt = `(${national.substring(0, 3)}) ${national.substring(3, 6)}-${national.substring(6)}`;
        intlFmt = `+1 ${national.substring(0, 3)}-${national.substring(3, 6)}-${national.substring(6)}`;
    }

    const isValid = digits.length >= 7 && digits.length <= 15;

    return {
        phone: e164,
        e164,
        international_number: intlFmt,
        local_number: localFmt,
        phone_valid: isValid,
        phone_type: numType,
        country: countryName,
        country_code: countryCode,
        country_prefix: countryPrefix,
        carrier: '',
        phone_region: ''
    };
}

async function enrichPhoneWithVeriphone(baseResult, digits, veriphoneApiKey) {
    if (!veriphoneApiKey) {
        return baseResult;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    try {
        const url = `https://api.veriphone.io/v2/verify?phone=%2B${encodeURIComponent(digits)}&key=${encodeURIComponent(veriphoneApiKey)}`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            return baseResult;
        }

        const data = await response.json();
        if (!data || data.status === 'error') {
            return baseResult;
        }

        return {
            ...baseResult,
            e164: data.e164 || baseResult.e164,
            phone: data.phone || baseResult.phone,
            international_number: data.international_number || baseResult.international_number,
            local_number: data.local_number || baseResult.local_number,
            phone_valid: typeof data.phone_valid === 'boolean' ? data.phone_valid : baseResult.phone_valid,
            phone_type: data.phone_type || baseResult.phone_type,
            country: data.country || baseResult.country,
            country_code: data.country_code || baseResult.country_code,
            country_prefix: data.country_prefix || baseResult.country_prefix,
            carrier: data.carrier || baseResult.carrier,
            phone_region: data.phone_region || baseResult.phone_region,
            lookup_source: 'veriphone'
        };
    } catch {
        return baseResult;
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = {
    parsePhoneNumber,
    enrichPhoneWithVeriphone
};
