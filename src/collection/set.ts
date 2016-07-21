import { Transaction, begin, commit, markAsDirty } from '../transactions.ts'
import { CollectionTransaction, IdIndex, aquire, free, sortElements, CollectionOptions, toModel, addIndex, CollectionCore, Elements, freeAll } from './commons.ts'
import { Record } from '../record/index.ts'

/*******
 * 
 */

const silentOptions = { silent : true };

export function emptySetTransaction( collection : CollectionCore, items : Elements, options : CollectionOptions, silent? : boolean ){
    const isRoot = begin( collection );

    const added = _reallocateEmpty( collection, items, options );

    if( added.length ){
        const needSort = sortElements( collection, options );

        if( markAsDirty( collection, silent ? silentOptions : options ) ){
            // 'added' is the reference to this.models. Need to copy it.
            return new CollectionTransaction( collection, isRoot, added.slice(), [], [], needSort );
        }
    }

    // No changes...
    isRoot && commit( collection );
};

export function setTransaction( collection, items, options ){
    const isRoot = begin( collection ),
          nested = [];

    var previous = collection.models,
        added    = _reallocate( collection, items, nested, options );

    const reusedCount = collection.models.length - added.length,
          removed = reusedCount < previous.length ? (
                        reusedCount ? _garbageCollect( collection, previous ) :
                                        freeAll( collection, previous )
                    ) : [];                    
    
    const addedOrChanged = nested.length || added.length,
          sorted = ( addedOrChanged && sortElements( collection, options ) ) || added.length || options.sorted;

    if( addedOrChanged || removed.length || sorted ){
        if( markAsDirty( collection, options ) ){ 
            return new CollectionTransaction( collection, isRoot, added, removed, nested, sorted );
        }
    }

    isRoot && commit( collection );
};

// Remove references to all previous elements, which are not present in collection.
// Returns an array with removed elements.
function _garbageCollect( collection : CollectionCore, previous : Record[] ) : Record[]{
    const { _byId }  = collection,
          removed = [];

    // Filter out removed models and remove them from the index...
    for( let record of previous ){
        if( !_byId[ record.cid ] ){
            removed.push( record );
            free( collection, record );
        }
    }

    return removed;
}

// reallocate model and index
function _reallocate( collection : CollectionCore, source : any[], nested : Transaction[], options ){
    var models      = Array( source.length ),
        _byId : IdIndex = {},
        merge       = options.merge == null ? true : options.merge,
        _prevById   = collection._byId,
        prevModels  = collection.models, 
        idAttribute = collection.model.prototype.idAttribute,
        toAdd       = [],
        orderKept   = true;

    // for each item in source set...
    for( var i = 0, j = 0; i < source.length; i++ ){
        var item  = source[ i ],
            model : Record = null;

        if( item ){
            var id  = item[ idAttribute ],
                cid = item.cid;

            if( _byId[ id ] || _byId[ cid ] ) continue;

            model = _prevById[ id ] || _prevById[ cid ];
        }

        if( model ){
            if( merge && item !== model ){
                if( orderKept && prevModels[ j ] !== model ) orderKept = false;

                var attrs = item.attributes || item;
                const transaction = model._createTransaction( attrs, options );
                transaction && nested.push( transaction );
            }
        }
        else{
            model = toModel( collection, item, options );
            aquire( collection, model );
            toAdd.push( model );
        }

        models[ j++ ] = model;
        addIndex( _byId, model );
    }

    models.length = j;
    collection.models   = models;
    collection._byId    = _byId;

    if( !orderKept ) options.sorted = true;

    return toAdd;
}

function _reallocateEmpty( self, source, options ){
    var len         = source ? source.length : 0,
        models      = Array( len ),
        _byId : IdIndex = {},
        idAttribute = self.model.prototype.idAttribute;

    for( var i = 0, j = 0; i < len; i++ ){
        var src = source[ i ];

        if( src && ( _byId[ src[ idAttribute ] ] || _byId[ src.cid ] ) ){
            continue;
        }

        var model = toModel( self, src, options );

        aquire( self, model );
        models[ j++ ] = model;
        addIndex( _byId, model );

    }

    models.length = j;
    self._byId    = _byId;

    return self.models = models;
}