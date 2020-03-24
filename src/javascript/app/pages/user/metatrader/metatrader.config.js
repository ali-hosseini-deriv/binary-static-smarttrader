const BinaryPjax   = require('../../../base/binary_pjax');
const Client       = require('../../../base/client');
const Header       = require('../../../base/header');
const BinarySocket = require('../../../base/socket');
const Dialog       = require('../../../common/attach_dom/dialog');
const Currency     = require('../../../common/currency');
const Validation   = require('../../../common/form_validation');
const GTM          = require('../../../../_common/base/gtm');
const localize     = require('../../../../_common/localize').localize;
const State        = require('../../../../_common/storage').State;
const urlFor       = require('../../../../_common/url').urlFor;
const isBinaryApp  = require('../../../../config').isBinaryApp;

const MetaTraderConfig = (() => {
    const configMtCompanies = (() => {
        let mt_companies;

        const initMtCompanies = () => {
            const standard_config = {
                account_type: 'standard',
                leverage    : 1000,
                short_title : localize('Standard'),
            };
            const advanced_config = {
                account_type: 'advanced',
                leverage    : 100,
                short_title : localize('Advanced'),
            };
            const volatility_config = {
                account_type: '',
                leverage    : 500,
                short_title : localize('Synthetic Indices'),
            };

            return ({
                gaming: {
                    demo_volatility: { mt5_account_type: volatility_config.account_type, max_leverage: volatility_config.leverage, title: localize('Demo Synthetic Indices'), short_title: volatility_config.short_title },
                    real_volatility: { mt5_account_type: volatility_config.account_type, max_leverage: volatility_config.leverage, title: localize('Real Synthetic Indices'), short_title: volatility_config.short_title },
                },
                financial: {
                    demo_standard: { mt5_account_type: standard_config.account_type, max_leverage: standard_config.leverage, title: localize('Demo Standard'), short_title: standard_config.short_title },
                    real_standard: { mt5_account_type: standard_config.account_type, max_leverage: standard_config.leverage, title: localize('Real Standard'), short_title: standard_config.short_title },
                    demo_advanced: { mt5_account_type: advanced_config.account_type, max_leverage: advanced_config.leverage, title: localize('Demo Advanced'), short_title: advanced_config.short_title },
                    real_advanced: { mt5_account_type: advanced_config.account_type, max_leverage: advanced_config.leverage, title: localize('Real Advanced'), short_title: advanced_config.short_title },
                },
            });
        };

        return {
            get: () => {
                if (!mt_companies) {
                    mt_companies = initMtCompanies();
                }
                return mt_companies;
            },
        };
    })();

    const configMtFinCompanies = (() => {
        let mt_financial_companies;

        const initMtFinCompanies = () => {
            const standard_config = {
                account_type: 'standard',
                leverage    : 30,
                short_title : localize('Standard'),
            };

            return ({
                // for financial mt company with shortcode maltainvest, only offer standard account with different leverage
                financial: {
                    demo_standard: { mt5_account_type: standard_config.account_type, max_leverage: standard_config.leverage, title: localize('Demo Standard'), short_title: standard_config.short_title },
                    real_standard: { mt5_account_type: standard_config.account_type, max_leverage: standard_config.leverage, title: localize('Real Standard'), short_title: standard_config.short_title },
                },
                gaming: {
                    demo_volatility: configMtCompanies.get().gaming.demo_volatility,
                    real_volatility: configMtCompanies.get().gaming.real_volatility,
                },
            });
        };

        return {
            get: () => {
                if (!mt_financial_companies) {
                    mt_financial_companies = initMtFinCompanies();
                }
                return mt_financial_companies;
            },
        };
    })();

    // we need to check if the account type is standard or advanced account before returning landing_company shortcode
    const getMTFinancialAccountType = acc_type => `${/_advanced$/.test(acc_type) ? 'advanced' : 'standard'}`;

    const accounts_info = {};

    let $messages;
    const needsRealMessage = () => $messages.find('#msg_switch').html();

    // currency equivalent to 1 USD
    // or 1 of donor currency if both accounts have the same currency
    const getMinMT5TransferValue = (currency) => {
        const client_currency = Client.get('currency');
        const mt5_currency    = getCurrency(Client.get('mt5_account'));
        if (client_currency === mt5_currency) return 1;
        return (+State.getResponse(`exchange_rates.rates.${currency}`) || 1).toFixed(Currency.getDecimalPlaces(currency));
    };

    // currency equivalent to 20000 USD
    const getMaxMT5TransferValue = (currency) => (
        (+getMinMT5TransferValue(currency) * 20000).toFixed(Currency.getDecimalPlaces(currency))
    );

    const newAccCheck = (acc_type, message_selector) => (
        new Promise((resolve) => {
            const $message = $messages.find('#msg_real_financial').clone();
            const is_virtual = Client.get('is_virtual');
            const is_demo = accounts_info[acc_type].is_demo;

            if (!Client.get('currency')) {
                resolve($messages.find('#msg_set_currency').html());
            } else if (is_demo) {
                resolve();
            } else if (is_virtual) { // virtual clients can only open demo MT accounts
                resolve(needsRealMessage());
            } else {
                BinarySocket.wait('get_settings').then(() => {
                    const showElementSetRedirect = (selector) => {
                        const $el = $message.find(selector);
                        $el.setVisibility(1);
                        const $link = $el.find('a');
                        $link.attr('href', `${$link.attr('href')}#mt5_redirect=${acc_type}`);
                    };
                    const resolveWithMessage = () => {
                        $message.find(message_selector).setVisibility(1);
                        resolve($message.html());
                    };

                    const has_financial_account = Client.hasAccountType('financial', 1);
                    const is_maltainvest        = State.getResponse(`landing_company.mt_financial_company.${getMTFinancialAccountType(acc_type)}.shortcode`) === 'maltainvest';
                    const is_demo_financial     = accounts_info[acc_type].account_type === 'demo' && accounts_info[acc_type].mt5_account_type; // is not demo vol account
                    const is_financial          = accounts_info[acc_type].account_type === 'financial';

                    if (is_maltainvest && (is_financial || is_demo_financial) && !has_financial_account) {
                        $message.find('.maltainvest').setVisibility(1);

                        resolveWithMessage();
                    }

                    const response_get_settings = State.getResponse('get_settings');
                    if (is_financial) {
                        const is_svg = State.getResponse(`landing_company.mt_financial_company.${getMTFinancialAccountType(acc_type)}.shortcode`) === 'svg';
                        if (is_svg) resolve();

                        let is_ok = true;
                        BinarySocket.wait('get_account_status', 'landing_company').then(async () => {
                            if (is_maltainvest && !has_financial_account) resolve();

                            const response_get_account_status = State.getResponse('get_account_status');
                            if (/financial_information_not_complete/.test(response_get_account_status.status)) {
                                showElementSetRedirect('.assessment');
                                is_ok = false;
                            } else if (/trading_experience_not_complete/.test(response_get_account_status.status)) {
                                showElementSetRedirect('.trading_experience');
                                is_ok = false;
                            }
                            if (+State.getResponse('landing_company.config.tax_details_required') === 1 && (!response_get_settings.tax_residence || !response_get_settings.tax_identification_number)) {
                                showElementSetRedirect('.tax');
                                is_ok = false;
                            }
                            if (!response_get_settings.citizen) {
                                showElementSetRedirect('.citizen');
                                is_ok = false;
                            }
                            if (is_ok && !isAuthenticated() && accounts_info[acc_type].mt5_account_type === 'advanced') {
                                await setLabuanAdvancedIntention();
                                $message.find('.authenticate').setVisibility(1);
                                is_ok = false;
                            }

                            if (is_ok) resolve();
                            else resolveWithMessage();
                        });
                    } else if (accounts_info[acc_type].account_type === 'gaming') {
                        let is_ok = true;
                        BinarySocket.wait('get_account_status', 'landing_company').then(() => {
                            const response_get_account_status = State.getResponse('get_account_status');
                            if (/financial_assessment_not_complete/.test(response_get_account_status.status)
                                && !accounts_info[acc_type].mt5_account_type // is_volatility
                                && /high/.test(response_get_account_status.risk_classification)
                            ) {
                                showElementSetRedirect('.assessment');
                                is_ok = false;
                            }
                            if (!response_get_settings.citizen
                                && !(is_maltainvest && !has_financial_account)
                                && accounts_info[acc_type].mt5_account_type) {
                                showElementSetRedirect('.citizen');
                                is_ok = false;
                            }

                            if (is_ok) resolve();
                            else resolveWithMessage();
                        });
                    }
                });
            }
        })
    );

    const setLabuanAdvancedIntention = new Promise((resolve) => {
        const req = {
            account_type    : 'financial',
            dry_run         : 1,
            email           : Client.get('email'),
            leverage        : 100,
            mainPassword    : 'Test1234',
            mt5_account_type: 'advanced',
            mt5_new_account : 1,
            name            : 'test real labuan advanced',
        };
        BinarySocket.send(req).then((response) => {
            if (response.error) {
                // update account status authentication info
                BinarySocket.send({ get_account_status: 1 }, { forced: true });
                resolve();
            }
        });
    });

    const actions_info = {
        new_account: {
            title        : localize('Sign up'),
            login        : response => response.mt5_new_account.login,
            prerequisites: acc_type => (
                newAccCheck(acc_type, '#msg_metatrader_account')
            ),
            pre_submit: ($form, acc_type) => (
                new Promise((resolve) => {
                    const is_volatility = !accounts_info[acc_type].mt5_account_type;

                    if (is_volatility && !accounts_info[acc_type].is_demo && State.getResponse('landing_company.gaming_company.shortcode') === 'malta') {
                        Dialog.confirm({
                            id               : 'confirm_new_account',
                            localized_message: localize(['Trading Contracts for Difference (CFDs) on Synthetic Indices may not be suitable for everyone. Please ensure that you fully understand the risks involved, including the possibility of losing all the funds in your MT5 account. Gambling can be addictive – please play responsibly.', 'Do you wish to continue?']),
                        }).then((is_ok) => {
                            if (!is_ok) {
                                BinaryPjax.load(Client.defaultRedirectUrl());
                            }
                            resolve(is_ok);
                        });
                    } else if (!accounts_info[acc_type].is_demo && Client.get('residence') === 'es') {
                        BinarySocket.send({ get_financial_assessment: 1 }).then((response) => {
                            const { cfd_score, trading_score } = response.get_financial_assessment;
                            const passed_financial_assessment = cfd_score === 4 || trading_score >= 8;
                            let message = [
                                localize('{SPAIN ONLY}You are about to purchase a product that is not simple and may be difficult to understand: Contracts for Difference and Forex. As a general rule, the CNMV considers that such products are not appropriate for retail clients, due to their complexity.'),
                                localize('{SPAIN ONLY}This is a product with leverage. You should be aware that losses may be higher than the amount initially paid to purchase the product.'),
                            ];
                            if (passed_financial_assessment) {
                                message.splice(1, 0, localize('{SPAIN ONLY}However, Binary Investments (Europe) Ltd has assessed your knowledge and experience and deems the product appropriate for you.'));
                            }
                            message = message.map(str => str.replace(/{SPAIN ONLY}/, '')); // remove '{SPAIN ONLY}' from english strings
                            Dialog.confirm({
                                id               : 'spain_cnmv_warning',
                                ok_text          : localize('Acknowledge'),
                                localized_message: message,
                            }).then((is_ok) => {
                                if (!is_ok) {
                                    BinaryPjax.load(Client.defaultRedirectUrl());
                                }
                                resolve(is_ok);
                            });
                        });
                    } else {
                        resolve(true);
                    }
                })
            ),
            onSuccess: (response) => {
                GTM.mt5NewAccount(response);

                BinarySocket.send({ get_account_status: 1 }, { forced: true }).then(() => {
                    Header.displayAccountStatus();
                });

                $('#financial_authenticate_msg').setVisibility(isAuthenticationPromptNeeded());
            },
        },

        password_change: {
            title        : localize('Change Password'),
            success_msg  : response => localize('The [_1] password of account number [_2] has been changed.', [response.echo_req.password_type, getDisplayLogin(response.echo_req.login)]),
            prerequisites: () => new Promise(resolve => resolve('')),
        },
        password_reset: {
            title: localize('Reset Password'),
        },
        verify_password_reset: {
            title               : localize('Verify Reset Password'),
            success_msg         : () => localize('Please check your email for further instructions.'),
            success_msg_selector: '#frm_verify_password_reset',
            onSuccess           : (response, $form) => {
                if (isBinaryApp()) {
                    $form.find('#frm_verify_password_reset').setVisibility(0);
                    const action      = 'verify_password_reset_token';
                    const reset_token = `#frm_${action}`;
                    $form.find(reset_token).setVisibility(1);
                    Validation.init(reset_token, validations()[action]);
                }
            },
        },
        verify_password_reset_token: {
            title    : localize('Verify Reset Password'),
            onSuccess: (response, $form) => {
                $form.find('#frm_verify_password_reset_token').setVisibility(0);
                const action         = 'password_reset';
                const password_reset = `#frm_${action}`;
                $form.find(password_reset).setVisibility(1);
                Validation.init(password_reset, validations()[action]);
            },
        },
        deposit: {
            title      : localize('Deposit'),
            success_msg: (response, acc_type) => localize('[_1] deposit from [_2] to account number [_3] is done. Transaction ID: [_4]', [
                Currency.formatMoney(State.getResponse('authorize.currency'), response.echo_req.amount),
                response.echo_req.from_binary,
                accounts_info[acc_type].info.display_login,
                response.binary_transaction_id,
            ]),
            prerequisites: () => new Promise((resolve) => {
                if (Client.get('is_virtual')) {
                    resolve(needsRealMessage());
                } else {
                    BinarySocket.send({ get_account_status: 1 }).then((response_status) => {
                        if (!response_status.error && /cashier_locked/.test(response_status.get_account_status.status)) {
                            resolve(localize('Your cashier is locked.')); // Locked from BO
                        } else {
                            const limit = State.getResponse('get_limits.remainder');
                            if (typeof limit !== 'undefined' && +limit < getMinMT5TransferValue(Client.get('currency'))) {
                                resolve(localize('You have reached the limit.'));
                            } else {
                                resolve();
                            }
                        }
                    });
                }
            }),
        },
        withdrawal: {
            title      : localize('Withdraw'),
            success_msg: (response, acc_type) => localize('[_1] withdrawal from account number [_2] to [_3] is done. Transaction ID: [_4]', [
                Currency.formatMoney(getCurrency(acc_type), response.echo_req.amount),
                accounts_info[acc_type].info.display_login,
                response.echo_req.to_binary,
                response.binary_transaction_id,
            ]),
            prerequisites: acc_type => new Promise((resolve) => {
                if (Client.get('is_virtual')) {
                    resolve(needsRealMessage());
                } else if (accounts_info[acc_type].account_type === 'financial') {
                    BinarySocket.send({ get_account_status: 1 }).then(() => {
                        if (!/svg_standard/.test(acc_type) && isAuthenticationPromptNeeded()) {
                            resolve($messages.find('#msg_authenticate').html());
                        }

                        resolve();
                    });
                } else {
                    resolve();
                }
            }),
        },
    };

    const fields = {
        new_account: {
            txt_name         : { id: '#txt_name',          request_field: 'name' },
            txt_main_pass    : { id: '#txt_main_pass',     request_field: 'mainPassword' },
            txt_re_main_pass : { id: '#txt_re_main_pass' },
            chk_tnc          : { id: '#chk_tnc' },
            additional_fields:
                acc_type => ($.extend(
                    {
                        account_type: accounts_info[acc_type].account_type,
                        email       : Client.get('email'),
                        leverage    : accounts_info[acc_type].max_leverage,
                    },
                    accounts_info[acc_type].mt5_account_type ? {
                        mt5_account_type: accounts_info[acc_type].mt5_account_type,
                    } : {})),
        },
        password_change: {
            ddl_password_type  : { id: '#ddl_password_type', request_field: 'password_type', is_radio: true },
            txt_old_password   : { id: '#txt_old_password',  request_field: 'old_password' },
            txt_new_password   : { id: '#txt_new_password',  request_field: 'new_password' },
            txt_re_new_password: { id: '#txt_re_new_password' },
            additional_fields  :
                acc_type => ({
                    login: accounts_info[acc_type].info.login,
                }),
        },
        password_reset: {
            ddl_password_type  : { id: '#ddl_reset_password_type', request_field: 'password_type', is_radio: true },
            txt_new_password   : { id: '#txt_reset_new_password',  request_field: 'new_password' },
            txt_re_new_password: { id: '#txt_reset_re_new_password' },
            additional_fields  :
                (acc_type, token) => ({
                    login            : accounts_info[acc_type].info.login,
                    verification_code: token,
                }),
        },
        verify_password_reset: {
            additional_fields:
                () => ({
                    verify_email: Client.get('email'),
                    type        : 'mt5_password_reset',
                }),
        },
        verify_password_reset_token: {
            txt_verification_code: { id: '#txt_verification_code' },
        },
        deposit: {
            txt_amount       : { id: '#txt_amount_deposit', request_field: 'amount' },
            additional_fields:
                acc_type => ({
                    from_binary: Client.get('loginid'),
                    to_mt5     : accounts_info[acc_type].info.login,
                }),
        },
        withdrawal: {
            txt_amount       : { id: '#txt_amount_withdrawal', request_field: 'amount' },
            additional_fields:
                acc_type => ({
                    from_mt5 : accounts_info[acc_type].info.login,
                    to_binary: Client.get('loginid'),
                }),
        },
    };

    const validations = () => ({
        new_account: [
            { selector: fields.new_account.txt_name.id,          validations: [['req', { hide_asterisk: true }], 'letter_symbol', ['length', { min: 2, max: 101 }]] },
            { selector: fields.new_account.txt_main_pass.id,     validations: [['req', { hide_asterisk: true }], ['password', 'mt']] },
            { selector: fields.new_account.txt_re_main_pass.id,  validations: [['req', { hide_asterisk: true }], ['compare', { to: fields.new_account.txt_main_pass.id }]] },
        ],
        password_change: [
            { selector: fields.password_change.ddl_password_type.id,   validations: [['req', { hide_asterisk: true }]] },
            { selector: fields.password_change.txt_old_password.id,    validations: [['req', { hide_asterisk: true }]] },
            { selector: fields.password_change.txt_new_password.id,    validations: [['req', { hide_asterisk: true }], ['password', 'mt'], ['not_equal', { to: fields.password_change.txt_old_password.id, name1: localize('Current password'), name2: localize('New password') }]], re_check_field: fields.password_change.txt_re_new_password.id },
            { selector: fields.password_change.txt_re_new_password.id, validations: [['req', { hide_asterisk: true }], ['compare', { to: fields.password_change.txt_new_password.id }]] },
        ],
        password_reset: [
            { selector: fields.password_reset.ddl_password_type.id,   validations: [['req', { hide_asterisk: true }]] },
            { selector: fields.password_reset.txt_new_password.id,    validations: [['req', { hide_asterisk: true }], ['password', 'mt']], re_check_field: fields.password_reset.txt_re_new_password.id },
            { selector: fields.password_reset.txt_re_new_password.id, validations: [['req', { hide_asterisk: true }], ['compare', { to: fields.password_reset.txt_new_password.id }]] },
        ],
        verify_password_reset_token: [
            { selector: fields.verify_password_reset_token.txt_verification_code.id, validations: [['req', { hide_asterisk: true }], 'token'], exclude_request: 1 },
        ],
        deposit: [
            { selector: fields.deposit.txt_amount.id, validations: [['req', { hide_asterisk: true }], ['number', { type: 'float', min: () => getMinMT5TransferValue(Client.get('currency')), max: () => Math.min(State.getResponse('get_limits.remainder') || getMaxMT5TransferValue(Client.get('currency')), getMaxMT5TransferValue(Client.get('currency'))).toFixed(Currency.getDecimalPlaces(Client.get('currency'))), decimals: Currency.getDecimalPlaces(Client.get('currency')) }], ['custom', { func: () => (Client.get('balance') && (+Client.get('balance') >= +$(fields.deposit.txt_amount.id).val())), message: localize('You have insufficient funds in your Binary account, please <a href="[_1]">add funds</a>.', urlFor('cashier')) }]] },
        ],
        withdrawal: [
            { selector: fields.withdrawal.txt_amount.id, validations: [['req', { hide_asterisk: true }], ['number', { type: 'float', min: () => getMinMT5TransferValue(getCurrency(Client.get('mt5_account'))), max: () => getMaxMT5TransferValue(getCurrency(Client.get('mt5_account'))), decimals: 2 }]] },
        ],
    });

    const hasAccount = acc_type => (accounts_info[acc_type] || {}).info;

    const getCurrency = acc_type => accounts_info[acc_type].info.currency;

    // if you have acc_type, use accounts_info[acc_type].info.display_login
    // otherwise, use this function to format login into display login
    const getDisplayLogin = login => login.replace(/^MT[DR]?/i, '');

    const isAuthenticated = () =>
        State.getResponse('get_account_status').status.indexOf('authenticated') !== -1;

    const isAuthenticationPromptNeeded = () => {
        const authentication = State.getResponse('get_account_status.authentication');
        const { identity, needs_verification } = authentication;
        const is_need_verification = needs_verification.length;
        const is_rejected_or_expired = /^(rejected|expired)$/.test(identity.status);

        if (is_rejected_or_expired) return false;

        return is_need_verification;
    };

    return {
        accounts_info,
        actions_info,
        getMTFinancialAccountType,
        fields,
        validations,
        needsRealMessage,
        hasAccount,
        getCurrency,
        getDisplayLogin,
        isAuthenticated,
        isAuthenticationPromptNeeded,
        configMtCompanies   : configMtCompanies.get,
        configMtFinCompanies: configMtFinCompanies.get,
        setMessages         : ($msg) => { $messages = $msg; },
        getAllAccounts      : () => (
            Object.keys(accounts_info)
                .filter(acc_type => hasAccount(acc_type))
                .sort(acc_type => (accounts_info[acc_type].is_demo ? 1 : -1)) // real first
        ),
    };
})();

module.exports = MetaTraderConfig;
